const consultaModelo = require('../modelos/consultaModelo');
const internoModelo = require('../modelos/internoModelo');
const psicopatologiaModelo = require('../modelos/psicopatologiaModelo');
const visitaModelo = require('../modelos/visitaModelo');
const medicamentoModelo = require('../modelos/medicamentoModelo');
const { texto, mayus, mayusParrafo } = require('../utilidades/texto');

const MAX_RECETAS = 20;

const MENSAJES = new Map([
  ['creada',      { tipo: 'success', texto: 'Consulta registrada. Si recetaste medicamentos, ya aparecen en la cola de farmacia.' }],
  ['anulada',     { tipo: 'success', texto: 'Consulta anulada. Se conserva en el historial y sus recetas pendientes salieron de farmacia.' }],
  ['no_existe',   { tipo: 'danger',  texto: 'La consulta o el interno no existe.' }],
  ['motivo_corto',{ tipo: 'danger',  texto: 'Explica por qué se anula (entre 10 y 255 caracteres).' }],
  ['ya_anulada',  { tipo: 'danger',  texto: 'Esa consulta ya estaba anulada.' }]
]);

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });

function comoLista(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor === undefined) return [];
  return [valor];
}

// Número opcional dentro de un rango. undefined = vacío (válido), null = escrito pero inválido.
function numeroOpcional(valor, minimo, maximo, decimales) {
  const t = String(valor === undefined ? '' : valor).trim().replace(',', '.');
  if (t === '') return undefined;
  const patron = decimales ? /^\d{1,3}(\.\d)?$/ : /^\d{1,3}$/;
  if (!patron.test(t)) return null;
  const n = Number(t);
  return n >= minimo && n <= maximo ? n : null;
}

// Lee y valida la consulta. Devuelve { datos, recetas, errores }.
function leerFormulario(body) {
  const errores = [];

  const temperatura = numeroOpcional(body.temperatura, 30, 45, true);
  const pulso = numeroOpcional(body.pulso, 20, 250, false);
  const saturacion = numeroOpcional(body.saturacion, 50, 100, false);
  const presionTexto = texto(body.presion);

  const datos = {
    motivo: mayusParrafo(body.motivo),
    hallazgos: mayusParrafo(body.hallazgos),
    diagnostico: mayusParrafo(body.diagnostico),
    indicaciones: mayusParrafo(body.indicaciones),
    temperatura: temperatura === undefined ? null : temperatura,
    pulso: pulso === undefined ? null : pulso,
    saturacion: saturacion === undefined ? null : saturacion,
    presion: presionTexto || null
  };

  if (datos.motivo.length < 3 || datos.motivo.length > 2000) errores.push('Escribe el motivo de la consulta (entre 3 y 2000 caracteres).');
  if (datos.diagnostico.length < 3 || datos.diagnostico.length > 2000) errores.push('El diagnóstico es obligatorio (entre 3 y 2000 caracteres).');
  if (datos.hallazgos.length > 2000) errores.push('Los hallazgos admiten máximo 2000 caracteres.');
  if (datos.indicaciones.length > 2000) errores.push('Las indicaciones admiten máximo 2000 caracteres.');
  if (temperatura === null) errores.push('La temperatura debe estar entre 30 y 45 °C (ejemplo: 38.5).');
  if (pulso === null) errores.push('El pulso debe ser un número entre 20 y 250.');
  if (saturacion === null) errores.push('La saturación debe ser un número entre 50 y 100.');
  if (presionTexto && !/^\d{2,3}\/\d{2,3}$/.test(presionTexto)) errores.push('La presión se escribe como 120/80.');

  // Recetas: medicamento del catálogo + cantidad + indicaciones. La fila sin medicamento se ignora.
  const meds = comoLista(body.receta_medicamento);
  const cantidades = comoLista(body.receta_cantidad);
  const indicaciones = comoLista(body.receta_indicaciones);
  const recetas = [];

  meds.slice(0, MAX_RECETAS).forEach((idTexto, i) => {
    const idMed = /^\d+$/.test(String(idTexto || '').trim()) ? parseInt(idTexto, 10) : null;
    if (!idMed) return;

    const cantTexto = String(cantidades[i] === undefined ? '' : cantidades[i]).trim();
    const cantidad = /^\d+$/.test(cantTexto) ? parseInt(cantTexto, 10) : 0;
    const indic = mayus(indicaciones[i]);

    if (cantidad < 1 || cantidad > 999) errores.push(`Receta ${i + 1}: la cantidad debe ser un número entre 1 y 999.`);
    if (!indic || indic.length > 100) errores.push(`Receta ${i + 1}: escribe cómo se toma (máximo 100 caracteres).`);

    recetas.push({ id_medicamento: idMed, cantidad: cantidad || '', cantidadTexto: cantTexto, indicaciones: indic });
  });

  return { datos, recetas, errores };
}

// Página principal: buscar un interno para atenderlo, y el historial de consultas
exports.indice = async (req, res) => {
  try {
    const busqueda = texto(req.query.q).slice(0, 100);
    const aviso = MENSAJES.get(req.query.msg);

    const consultas = await consultaModelo.listar(busqueda);

    res.render('consultas/indice', {
      ...base(req, 'Consultas médicas'),
      consultas,
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las consultas');
  }
};

async function pintarFormulario(req, res, interno, form, recetas, mensaje) {
  const [padecimientos, consultasPrevias, visitas, catalogo] = await Promise.all([
    psicopatologiaModelo.listarActivas(interno.id_interno),
    consultaModelo.deInterno(interno.id_interno, 5),
    visitaModelo.historialDelInterno(interno.id_interno, 0),
    medicamentoModelo.listarActivos()
  ]);

  // Al volver a mostrar el formulario (por un error), cada receta conserva el nombre del medicamento elegido
  const filas = recetas.map((r) => {
    const med = catalogo.find((m) => m.id_medicamento === r.id_medicamento);
    return {
      ...r,
      etiqueta: med ? `${med.nombre} ${med.presentacion}`.trim() : '',
      id_medicamento: med ? r.id_medicamento : ''
    };
  });

  res.render('consultas/formulario', {
    ...base(req, 'Nueva consulta'),
    interno,
    consultaForm: form,
    filas,
    catalogo,
    padecimientos,
    consultasPrevias,
    visitas: visitas.slice(0, 5),
    mensaje
  });
}

exports.mostrarNueva = async (req, res) => {
  try {
    const id = parseInt(req.params.idInterno, 10);
    const interno = Number.isNaN(id) ? null : await internoModelo.buscarFicha(id);

    if (!interno || interno.estado !== 1) return res.redirect('/consultas?msg=no_existe');

    await pintarFormulario(req, res, interno, {}, [], null);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario de consulta');
  }
};

exports.crear = async (req, res) => {
  try {
    const id = parseInt(req.params.idInterno, 10);
    const interno = Number.isNaN(id) ? null : await internoModelo.buscarFicha(id);

    if (!interno || interno.estado !== 1) return res.redirect('/consultas?msg=no_existe');

    const { datos, recetas, errores } = leerFormulario(req.body);
    const form = { ...datos, temperatura: req.body.temperatura, pulso: req.body.pulso, saturacion: req.body.saturacion, presion: req.body.presion };

    if (errores.length > 0) {
      return pintarFormulario(req, res, interno, form, recetas, errores.join(' '));
    }

    let idConsulta;
    try {
      idConsulta = await consultaModelo.crear({ ...datos, id_interno: id, id_medico: req.session.idUsuario }, recetas);
    } catch (error) {
      if (error.deNegocio) return pintarFormulario(req, res, interno, form, recetas, error.message);
      throw error;
    }

    res.redirect(`/consultas/${idConsulta}?msg=creada`);
  } catch (error) {
    console.error(error);
    res.send('Error al guardar la consulta');
  }
};

exports.detalle = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const consulta = Number.isNaN(id) ? null : await consultaModelo.buscarPorId(id);

    if (!consulta) return res.redirect('/consultas?msg=no_existe');

    const aviso = MENSAJES.get(req.query.msg);

    res.render('consultas/detalle', {
      ...base(req, `Consulta #${consulta.id_consulta}`),
      consulta,
      recetas: await consultaModelo.recetas(id),
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la consulta');
  }
};

exports.anular = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.redirect('/consultas?msg=no_existe');

    const motivo = mayus(req.body.motivo);
    if (motivo.length < 10 || motivo.length > 255) return res.redirect(`/consultas/${id}?msg=motivo_corto`);

    const cambio = await consultaModelo.anular(id, motivo);
    res.redirect(`/consultas/${id}?msg=${cambio ? 'anulada' : 'ya_anulada'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al anular la consulta');
  }
};
