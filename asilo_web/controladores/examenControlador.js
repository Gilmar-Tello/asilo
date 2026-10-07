const examenModelo = require('../modelos/examenModelo');
const visitaModelo = require('../modelos/visitaModelo');
const calculadorCostos = require('../servicios/calculadorCostos');
const { texto, mayusParrafo } = require('../utilidades/texto');

const MAX_IMPORTE = 99999.99;   // cabe en DECIMAL(10,2) con margen

// Precio en quetzales: acepta "25" o "25,50". Devuelve null si no es válido (y también si está vacío:
// el laboratorio tiene que escribir el precio, aunque sea 0).
function leerImporte(valor) {
  const limpio = String(valor === undefined ? '' : valor).trim().replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;

  const numero = Number(limpio);
  return numero <= MAX_IMPORTE ? numero : null;
}

const ESTADOS = ['Ordenado', 'Con resultado', 'Anulado'];

const CLASES_ESTADO = {
  'Ordenado':      'text-bg-warning',
  'Con resultado': 'text-bg-success',
  'Anulado':       'text-bg-secondary'
};

// Mensajes fijos que viajan por la URL (?msg=...)
const MENSAJES = new Map([
  ['guardado',     { tipo: 'success', texto: 'Resultado guardado. Ya está disponible en el historial del interno.' }],
  ['no_existe',    { tipo: 'danger',  texto: 'La orden de examen no existe.' }],
  ['no_disponible',{ tipo: 'danger',  texto: 'Esa orden ya no admite resultado (ya tiene uno o fue anulada).' }],
  ['precio_invalido', { tipo: 'danger', texto: 'Escribe el precio real del examen en quetzales (ejemplo: 85 o 85.50).' }],
  ['resultado_corto', { tipo: 'danger', texto: 'Escribe el resultado del examen (entre 3 y 5000 caracteres).' }]
]);

const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

function tienePermiso(res, clave) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes(clave);
}

// Órdenes de examen. Por defecto, las pendientes (lo primero que busca el laboratorista).
exports.listar = async (req, res) => {
  try {
    const estado = req.query.estado === 'todos' ? '' : (ESTADOS.includes(req.query.estado) ? req.query.estado : 'Ordenado');
    const busqueda = texto(req.query.q).slice(0, 100);

    const filas = await examenModelo.listar({ estado, busqueda });
    const aviso = MENSAJES.get(req.query.msg);

    res.render('examenes/listar', {
      ...base(req, 'Exámenes de laboratorio'),
      lista: filas.map((e) => ({ ...e, clase_estado: CLASES_ESTADO[e.estado] || 'text-bg-secondary' })),
      estado: estado || 'todos',
      estados: ESTADOS,
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los exámenes');
  }
};

exports.detalle = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const examen = Number.isNaN(id) ? null : await examenModelo.buscarPorId(id);

    if (!examen) {
      return res.redirect('/examenes?msg=no_existe');
    }

    const aviso = MENSAJES.get(req.query.msg);

    res.render('examenes/detalle', {
      ...base(req, `Examen #${examen.id_examen}`),
      examen: { ...examen, clase_estado: CLASES_ESTADO[examen.estado] || 'text-bg-secondary' },
      puedeRegistrar: examen.estado === 'Ordenado' && tienePermiso(res, 'examenes:registrar_resultado'),
      form: {},
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el examen');
  }
};

// El laboratorista guarda el resultado
exports.registrarResultado = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const examen = Number.isNaN(id) ? null : await examenModelo.buscarPorId(id);

    if (!examen) {
      return res.redirect('/examenes?msg=no_existe');
    }

    // Regla del proyecto: el texto libre va en MAYÚSCULAS
    const resultado = mayusParrafo(req.body.resultado);

    if (resultado.length < 3 || resultado.length > 5000) {
      return res.redirect(`/examenes/${id}?msg=resultado_corto`);
    }

    // El precio REAL lo pone el laboratorio. La repetición de un examen anulado no se vuelve a cobrar: va en 0.
    const esRepeticion = Boolean(examen.id_examen_origen);
    const costoReal = esRepeticion ? 0 : leerImporte(req.body.costo_real);

    if (costoReal === null) {
      return res.redirect(`/examenes/${id}?msg=precio_invalido`);
    }

    const cambio = await examenModelo.registrarResultado(id, resultado, req.session.idUsuario, costoReal);

    // 0 = otra persona ya cargó el resultado, o la orden se anuló: nunca se pisa (RN12)
    if (cambio === 0) {
      return res.redirect(`/examenes/${id}?msg=no_disponible`);
    }

    // El total de la visita cambió: se recalcula con el microservicio de costos (20% de descuento).
    // Si no responde, la visita queda "pendiente de cálculo" y se reintenta sola.
    const visita = await visitaModelo.buscarPorId(examen.id_visita);
    if (visita && visita.estado_costo === 'Pendiente de cálculo') {
      await calculadorCostos.calcularVisita(visita);
    }

    res.redirect(`/examenes?msg=guardado`);
  } catch (error) {
    console.error(error);
    res.send('Error al guardar el resultado');
  }
};

// El especialista pide anular un resultado equivocado (FA-04 del CU-04).
// Solo el especialista de ESA visita (o el administrador) puede hacerlo.
exports.anular = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const examen = Number.isNaN(id) ? null : await examenModelo.buscarPorId(id);

    if (!examen) {
      return res.redirect('/visitas/agenda?msg=no_existe');
    }

    const volver = (clave) => res.redirect(`/visitas/${examen.id_visita}?msg=${clave}`);

    if (!res.locals.rolEsSistema && examen.id_especialista !== req.session.idUsuario) {
      return volver('examen_no_anulable');
    }

    const motivo = texto(req.body.motivo).toUpperCase();

    if (motivo.length < 10 || motivo.length > 255) {
      return volver('motivo_corto');
    }

    const nuevo = await examenModelo.anular(id, motivo);

    if (!nuevo) {
      return volver('examen_no_anulable');
    }

    volver('examen_anulado');
  } catch (error) {
    console.error(error);
    res.send('Error al anular el examen');
  }
};
