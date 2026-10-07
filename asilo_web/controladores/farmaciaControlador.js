const farmaciaModelo = require('../modelos/farmaciaModelo');
const medicamentoModelo = require('../modelos/medicamentoModelo');
const visitaModelo = require('../modelos/visitaModelo');
const calculadorCostos = require('../servicios/calculadorCostos');
const { texto } = require('../utilidades/texto');

const MAX_LINEAS = 50;
const MAX_CAJON = 999;   // el cajón no tiene receta que lo limite: tope razonable por despacho

const MENSAJES = new Map([
  ['despachado',     { tipo: 'success', texto: 'Despacho registrado. El costo de las recetas se sumó a la cuenta de su visita.' }],
  ['costo_pendiente',{ tipo: 'warning', texto: 'Despacho registrado. El microservicio de costos no respondió: el total de la visita quedó "pendiente de cálculo" y se reintentará solo.' }],
  ['sin_existencia', { tipo: 'info',    texto: 'Se marcó como "sin existencia". El especialista lo verá en la visita para valorar una sustitución.' }],
  ['no_existe',      { tipo: 'danger',  texto: 'El interno o el despacho no existe.' }]
]);

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });

// Sugiere el medicamento del catálogo que corresponde a lo que escribió el especialista.
// Primero el nombre exacto; si no, el que contiene al otro. Si no hay parecido, ninguno.
function sugerir(recetado, catalogo) {
  const buscado = String(recetado || '').toUpperCase().trim();
  if (!buscado) return null;

  const exacto = catalogo.find((m) => m.nombre === buscado || `${m.nombre} ${m.presentacion}`.trim() === buscado);
  if (exacto) return exacto;

  return catalogo.find((m) => buscado.includes(m.nombre) || m.nombre.includes(buscado)) || null;
}

// Arma las filas del "carrito": primero las recetas pendientes, después los medicamentos de cajón.
// 'previo' son los valores que el usuario ya había puesto (cuando se vuelve a mostrar por un error).
function armarFilas(recetas, cajon, catalogo, previo) {
  const filas = [];

  const opcionesPara = (idElegido) => catalogo.map((m) => ({
    ...m,
    elegido: m.id_medicamento === idElegido
  }));

  for (const r of recetas) {
    const clave = `receta-${r.id_receta}`;
    const antes = previo[clave];
    const sugerido = sugerir(r.medicamento, catalogo);
    const idElegido = antes ? antes.id_medicamento : (sugerido ? sugerido.id_medicamento : null);
    const cantidad = antes
      ? antes.cantidad
      : (sugerido ? Math.min(r.pendiente, sugerido.existencia) : 0);

    filas.push({
      tipo: 'receta',
      id_origen: r.id_receta,
      titulo: r.medicamento,
      detalle: `${r.cantidad} recetado(s) · ${r.tiempo_aplicacion}${r.area_aplicacion ? ' · ' + r.area_aplicacion : ''} · visita ${r.fecha_visita_texto} · ${r.especialista_nombre}`,
      despachado: r.cantidad_despachada,
      maximo: r.pendiente,
      marcadoSinExistencia: antes ? antes.sin_existencia : false,
      yaSinExistencia: r.sin_existencia === 1,
      cantidad,
      opciones: opcionesPara(idElegido)
    });
  }

  for (const c of cajon) {
    const clave = `cajon-${c.id_psicopatologia}`;
    const antes = previo[clave];
    const sugerido = sugerir(c.medicamento_cajon, catalogo);
    const idElegido = antes ? antes.id_medicamento : (sugerido ? sugerido.id_medicamento : null);

    filas.push({
      tipo: 'cajon',
      id_origen: c.id_psicopatologia,
      titulo: c.medicamento_cajon,
      detalle: `Cajón · ${c.nombre_padecimiento}${c.dosis ? ' · dosis ' + c.dosis : ''}`,
      maximo: MAX_CAJON,
      cantidad: antes ? antes.cantidad : 0,   // el cajón no se precarga: se despacha cuando se necesita
      opciones: opcionesPara(idElegido)
    });
  }

  return filas.map((f, indice) => ({ ...f, indice }));
}

// Lee las líneas que mandó el POS. Con extended:true pueden llegar como lista o como objeto
// (si hay más de 20, el lector las convierte en objeto), así que se toman los valores en ambos casos.
function leerLineas(body) {
  const crudas = body.lineas && typeof body.lineas === 'object' ? Object.values(body.lineas) : [];
  const entero = (v) => (/^\d+$/.test(String(v === undefined ? '' : v).trim()) ? parseInt(v, 10) : null);

  return crudas.slice(0, MAX_LINEAS).map((l) => ({
    tipo: l && l.tipo === 'cajon' ? 'cajon' : 'receta',
    id_origen: entero(l && l.id_origen),
    id_medicamento: entero(l && l.id_medicamento),
    cantidad: entero(!l || l.cantidad === undefined || l.cantidad === '' ? '0' : l.cantidad),
    sin_existencia: Boolean(l && l.sin_existencia)
  }));
}

async function pintarPos(req, res, interno, mensaje, tipo, previo = {}) {
  const [recetas, cajon, despachadas, catalogo] = await Promise.all([
    farmaciaModelo.recetasPendientes(interno.id_interno),
    farmaciaModelo.medicamentosCajon(interno.id_interno),
    farmaciaModelo.recetasDespachadas(interno.id_interno),
    medicamentoModelo.listarActivos()
  ]);

  res.render('farmacia/pos', {
    ...base(req, 'Farmacia'),
    interno,
    filas: armarFilas(recetas, cajon, catalogo, previo),
    hayRecetas: recetas.length > 0,
    despachadas,
    catalogoVacio: catalogo.length === 0,
    mensaje,
    tipo
  });
}

// La cola: internos con recetas por despachar (o la búsqueda)
exports.cola = async (req, res) => {
  try {
    const busqueda = texto(req.query.q).slice(0, 100);
    const aviso = MENSAJES.get(req.query.msg);

    res.render('farmacia/cola', {
      ...base(req, 'Farmacia'),
      lista: await farmaciaModelo.cola(busqueda),
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la farmacia');
  }
};

// El POS de un interno
exports.pos = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const interno = Number.isNaN(id) ? null : await farmaciaModelo.buscarInterno(id);

    if (!interno || interno.estado !== 1) {
      return res.redirect('/farmacia?msg=no_existe');
    }

    const aviso = MENSAJES.get(req.query.msg);
    await pintarPos(req, res, interno, aviso ? aviso.texto : null, aviso ? aviso.tipo : null);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el despacho');
  }
};

// Confirmar el despacho
exports.despachar = async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const interno = Number.isNaN(id) ? null : await farmaciaModelo.buscarInterno(id);

    if (!interno || interno.estado !== 1) {
      return res.redirect('/farmacia?msg=no_existe');
    }

    const lineas = leerLineas(req.body);

    // Lo que puso el usuario, para no perderlo si hay que volver a mostrar el POS
    const previo = {};
    for (const l of lineas) {
      if (l.id_origen) {
        previo[`${l.tipo}-${l.id_origen}`] = { id_medicamento: l.id_medicamento, cantidad: l.cantidad || 0, sin_existencia: l.sin_existencia };
      }
    }

    const volver = (mensaje) => pintarPos(req, res, interno, mensaje, 'danger', previo);

    // Solo se aceptan recetas y cajones que de verdad son de este interno (el formulario se puede manipular)
    const [recetas, cajon] = await Promise.all([
      farmaciaModelo.recetasPendientes(id),
      farmaciaModelo.medicamentosCajon(id)
    ]);
    const recetasPorId = new Map(recetas.map((r) => [r.id_receta, r]));
    const cajonPorId = new Set(cajon.map((c) => c.id_psicopatologia));

    const aDespachar = [];
    const sinExistencia = [];

    for (const l of lineas) {
      if (l.id_origen === null || l.cantidad === null) {
        return volver('Hay una cantidad que no es un número entero.');
      }

      const receta = l.tipo === 'receta' ? recetasPorId.get(l.id_origen) : null;

      if (l.tipo === 'receta' && !receta) {
        return volver('Una de las recetas ya no está pendiente (quizá otra persona la despachó). Revisa la lista.');
      }
      if (l.tipo === 'cajon' && !cajonPorId.has(l.id_origen)) {
        return volver('Uno de los medicamentos de cajón ya no está vigente.');
      }

      if (l.cantidad === 0) {
        if (l.sin_existencia && receta) sinExistencia.push(l.id_origen);   // FA-02
        continue;
      }

      if (l.sin_existencia) {
        return volver(`"${receta ? receta.medicamento : 'Un medicamento'}" está marcado sin existencia pero también tiene cantidad. Deja una de las dos.`);
      }
      if (!l.id_medicamento) {
        return volver('Elige del catálogo el medicamento que vas a entregar en cada línea con cantidad.');
      }
      // RN11 / FE-02: nunca más de lo recetado
      if (receta && l.cantidad > receta.pendiente) {
        return volver(`De ${receta.medicamento} solo quedan ${receta.pendiente} por despachar: no se puede entregar más de lo recetado.`);
      }
      if (!receta && l.cantidad > MAX_CAJON) {
        return volver(`Máximo ${MAX_CAJON} unidades de cajón por despacho.`);
      }

      aDespachar.push(l);
    }

    if (aDespachar.length === 0 && sinExistencia.length === 0) {
      return volver('No hay nada que despachar: escribe una cantidad o marca un medicamento sin existencia.');
    }

    let resultado;
    try {
      resultado = await farmaciaModelo.despachar({
        idInterno: id,
        idFarmaceutico: req.session.idUsuario,
        lineas: aDespachar,
        sinExistencia
      });
    } catch (error) {
      if (error.deNegocio) return volver(error.message);
      throw error;
    }

    // Las visitas cambiaron de total: se recalcula con el microservicio (si no responde, se reintenta solo)
    let todoCalculado = true;
    for (const idVisita of resultado.visitas) {
      const visita = await visitaModelo.buscarPorId(idVisita);
      if (visita && visita.estado_costo === 'Pendiente de cálculo') {
        todoCalculado = (await calculadorCostos.calcularVisita(visita)) && todoCalculado;
      }
    }

    if (!resultado.idDespacho) {
      return res.redirect(`/farmacia/interno/${id}?msg=sin_existencia`);
    }

    res.redirect(`/farmacia/despachos/${resultado.idDespacho}?msg=${todoCalculado ? 'despachado' : 'costo_pendiente'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el despacho');
  }
};

// Comprobante de un despacho
exports.comprobante = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const despacho = Number.isNaN(id) ? null : await farmaciaModelo.buscarDespacho(id);

    if (!despacho) return res.redirect('/farmacia/despachos?msg=no_existe');

    const aviso = MENSAJES.get(req.query.msg);

    res.render('farmacia/comprobante', {
      ...base(req, `Despacho #${despacho.id_despacho}`),
      despacho,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el comprobante');
  }
};

exports.despachos = async (req, res) => {
  try {
    const busqueda = texto(req.query.q).slice(0, 100);
    const aviso = MENSAJES.get(req.query.msg);

    res.render('farmacia/despachos', {
      ...base(req, 'Despachos de farmacia'),
      lista: await farmaciaModelo.listarDespachos(busqueda),
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los despachos');
  }
};
