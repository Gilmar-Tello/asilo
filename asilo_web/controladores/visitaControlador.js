const visitaModelo = require('../modelos/visitaModelo');
const psicopatologiaModelo = require('../modelos/psicopatologiaModelo');
const medicamentoModelo = require('../modelos/medicamentoModelo');
const calculadorCostos = require('../servicios/calculadorCostos');
const sincronizador = require('../servicios/sincronizadorSolicitudes');
const { texto, mayus, mayusParrafo } = require('../utilidades/texto');

const MAX_FILAS = 20;          // exámenes o recetas por visita
const MAX_IMPORTE = 99999.99;  // cabe en DECIMAL(10,2) con margen

// Mensajes fijos que viajan por la URL (?msg=...)
const MENSAJES = new Map([
  ['borrador',    { tipo: 'info',    texto: 'Borrador guardado. Puedes retomarlo cuando quieras desde tu agenda.' }],
  ['registrada',  { tipo: 'success', texto: 'Visita registrada. La solicitud quedó como "Atendida" y el costo ya se calculó.' }],
  ['registrada_sin_cargos', { tipo: 'success', texto: 'Visita registrada. La solicitud quedó como "Atendida". No hay importes que cobrar.' }],
  ['costo_pendiente', { tipo: 'warning', texto: 'Visita registrada. El microservicio de costos no respondió: el importe quedó "pendiente de cálculo" y se reintentará solo.' }],
  ['no_asistio',  { tipo: 'secondary', texto: 'Se registró que el interno no asistió. No se generó ningún cargo.' }],
  ['no_existe',   { tipo: 'danger',  texto: 'La visita no existe.' }],
  ['sin_cita',    { tipo: 'danger',  texto: 'Esa cita no está programada a tu nombre, o ya no está disponible para atender.' }],
  ['examen_anulado',    { tipo: 'success', texto: 'Resultado anulado. Se conserva en el historial como "Anulado" y se generó una nueva orden de examen para el laboratorio.' }],
  ['examen_no_anulable',{ tipo: 'danger',  texto: 'Ese examen no se puede anular (solo el especialista de la visita, y solo si ya tiene resultado).' }],
  ['motivo_corto',      { tipo: 'danger',  texto: 'Explica por qué se anula el resultado (entre 10 y 255 caracteres).' }],
  ['ya_cerrada',  { tipo: 'danger',  texto: 'Esa visita ya se cerró desde otra pantalla: no se puede modificar.' }]
]);

const CLASES_ESTADO = {
  'Borrador':   'text-bg-warning',
  'Registrada': 'text-bg-success',
  'No asistió': 'text-bg-secondary'
};

const CLASES_COSTO = {
  'Sin cargos':           'text-bg-light border',
  'Pendiente de cálculo': 'text-bg-warning',
  'Calculado':            'text-bg-success'
};

const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

function tienePermiso(res, clave) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes(clave);
}

// Convierte lo que llega del formulario a lista (con un solo elemento llega como texto, no como lista)
function comoLista(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor === undefined) return [];
  return [valor];
}

// Importe en quetzales: acepta "25" o "25,50". Devuelve null si no es un importe válido.
function leerImporte(valor) {
  const limpio = String(valor === undefined ? '' : valor).trim().replace(',', '.');

  if (limpio === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;

  const numero = Number(limpio);
  return numero <= MAX_IMPORTE ? numero : null;
}

// Lee y valida el formulario. Devuelve { datos, errores }.
// Cuando hay errores, 'datos' conserva lo escrito para volver a mostrarlo.
function leerFormulario(body, confirmando) {
  const errores = [];

  const diagnostico = mayusParrafo(body.diagnostico);
  const observaciones = mayusParrafo(body.observaciones);
  const costoConsulta = leerImporte(body.costo_consulta);

  if (diagnostico.length > 5000) errores.push('El diagnóstico es demasiado largo (máximo 5000 caracteres).');
  if (observaciones.length > 5000) errores.push('Las observaciones son demasiado largas (máximo 5000 caracteres).');
  if (costoConsulta === null) errores.push('El costo de la consulta no es válido (ejemplo: 150 o 150.50).');

  // FE-01: sin diagnóstico no se confirma la visita (y por lo tanto no llega a facturación, RN2)
  if (confirmando && diagnostico.length < 5) {
    errores.push('El diagnóstico es obligatorio para confirmar la visita (mínimo 5 caracteres).');
  }

  // Exámenes: la fila sin nombre se ignora
  // (en el formulario los campos se llaman examen_nombre[]: el lector de formularios los entrega
  //  como lista bajo el nombre sin corchetes)
  const nombresExamen = comoLista(body.examen_nombre);
  const costosExamen = comoLista(body.examen_costo);
  const examenes = [];

  nombresExamen.slice(0, MAX_FILAS).forEach((nombreCrudo, i) => {
    const nombre = mayus(nombreCrudo);
    if (!nombre) return;

    const costo = leerImporte(costosExamen[i]);
    if (nombre.length > 100) errores.push(`Examen "${nombre.slice(0, 20)}...": el nombre es demasiado largo (máximo 100).`);
    if (costo === null) errores.push(`Examen "${nombre}": el costo estimado no es válido.`);

    examenes.push({ nombre, costo: costo === null ? 0 : costo, costoTexto: costosExamen[i] === undefined ? '' : String(costosExamen[i]) });
  });

  // Recetas: la fila sin medicamento se ignora
  const medicamentos = comoLista(body.receta_medicamento);
  const areas = comoLista(body.receta_area);
  const cantidades = comoLista(body.receta_cantidad);
  const tiempos = comoLista(body.receta_tiempo);
  const recetas = [];

  medicamentos.slice(0, MAX_FILAS).forEach((medicamentoCrudo, i) => {
    const medicamento = mayus(medicamentoCrudo);
    if (!medicamento) return;

    const area = mayus(areas[i]);
    const tiempo = mayus(tiempos[i]);
    const cantidadTexto = String(cantidades[i] === undefined ? '' : cantidades[i]).trim();
    const cantidad = /^\d+$/.test(cantidadTexto) ? parseInt(cantidadTexto, 10) : 0;

    if (medicamento.length > 100) errores.push(`Medicamento "${medicamento.slice(0, 20)}...": el nombre es demasiado largo (máximo 100).`);
    if (area.length > 60) errores.push(`Medicamento "${medicamento}": el área es demasiado larga (máximo 60).`);
    if (cantidad < 1 || cantidad > 9999) errores.push(`Medicamento "${medicamento}": la cantidad debe ser un número entre 1 y 9999.`);
    if (!tiempo || tiempo.length > 60) errores.push(`Medicamento "${medicamento}": indica el tiempo de aplicación (máximo 60 caracteres).`);

    recetas.push({ medicamento, area, cantidad: cantidad || '', cantidadTexto, tiempo });
  });

  const costoExamenes = examenes.reduce((suma, e) => suma + e.costo, 0);

  return {
    errores,
    datos: {
      diagnostico,
      observaciones,
      costo_consulta: costoConsulta === null ? 0 : costoConsulta,
      costo_consulta_texto: body.costo_consulta === undefined ? '' : String(body.costo_consulta),
      costo_examenes: Math.round(costoExamenes * 100) / 100,
      examenes,
      recetas
    }
  };
}

// Pinta el formulario de la visita con todo lo que el especialista necesita ver (pasos 2 a 4 del CU-04)
async function mostrarFormulario(req, res, cita, borrador, form, mensaje, tipo = 'danger') {
  const [padecimientos, historial, catalogo] = await Promise.all([
    psicopatologiaModelo.listarPorInterno(cita.id_interno),
    visitaModelo.historialDelInterno(cita.id_interno, borrador ? borrador.id_visita : 0),
    // Para sugerir nombres al recetar (así farmacia los reconoce). Sigue siendo texto libre.
    medicamentoModelo.listarActivos()
  ]);

  res.render('visitas/formulario', {
    ...base(req, 'Registrar visita médica'),
    cita,
    borrador,
    visitaForm: form,
    padecimientos,
    historial,
    catalogo,
    mensaje,
    tipo: mensaje ? tipo : null
  });
}

// El borrador guardado, con la forma que usa el formulario
async function formularioDesdeBorrador(borrador) {
  if (!borrador) {
    return { diagnostico: '', observaciones: '', costo_consulta_texto: '', examenes: [], recetas: [] };
  }

  const [examenes, recetas] = await Promise.all([
    visitaModelo.listarExamenes(borrador.id_visita),
    visitaModelo.listarRecetas(borrador.id_visita)
  ]);

  return {
    diagnostico: borrador.diagnostico || '',
    observaciones: borrador.observaciones || '',
    costo_consulta_texto: Number(borrador.costo_consulta) > 0 ? String(Number(borrador.costo_consulta)) : '',
    examenes: examenes.map((e) => ({ nombre: e.nombre_examen, costoTexto: Number(e.costo_estimado) > 0 ? String(Number(e.costo_estimado)) : '' })),
    recetas: recetas.map((r) => ({
      medicamento: r.medicamento, area: r.area_aplicacion || '',
      cantidadTexto: String(r.cantidad), tiempo: r.tiempo_aplicacion
    }))
  };
}

// Mi agenda: las citas programadas a mi nombre
exports.agenda = async (req, res) => {
  try {
    const filas = await visitaModelo.agenda(req.session.idUsuario);
    const aviso = MENSAJES.get(req.query.msg);

    res.render('visitas/agenda', {
      ...base(req, 'Mi agenda de visitas'),
      citas: filas,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la agenda');
  }
};

// Historial de todas las visitas (visitas:ver)
exports.listar = async (req, res) => {
  try {
    const busqueda = texto(req.query.q).slice(0, 100);
    const filas = await visitaModelo.listar(busqueda);
    const aviso = MENSAJES.get(req.query.msg);

    res.render('visitas/listar', {
      ...base(req, 'Visitas médicas'),
      lista: filas.map((v) => ({
        ...v,
        clase_estado: CLASES_ESTADO[v.estado] || 'text-bg-secondary',
        clase_costo: CLASES_COSTO[v.estado_costo] || 'text-bg-secondary'
      })),
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las visitas');
  }
};

// Formulario de la visita (nuevo, o el borrador para retomarlo)
exports.mostrarAtender = async (req, res) => {
  try {
    const idSolicitud = parseInt(req.params.idSolicitud, 10);
    // RN7: solo si la cita está programada Y es de este especialista
    const cita = Number.isNaN(idSolicitud) ? null : await visitaModelo.buscarCita(idSolicitud, req.session.idUsuario);

    if (!cita) {
      return res.redirect('/visitas/agenda?msg=sin_cita');
    }

    const borrador = await visitaModelo.buscarBorrador(idSolicitud);
    const form = await formularioDesdeBorrador(borrador);

    const aviso = MENSAJES.get(req.query.msg);

    await mostrarFormulario(req, res, cita, borrador, form, aviso ? aviso.texto : null, aviso ? aviso.tipo : 'danger');
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario de la visita');
  }
};

// Guarda borrador, confirma la visita o registra la inasistencia
exports.atender = async (req, res) => {
  try {
    const idSolicitud = parseInt(req.params.idSolicitud, 10);
    const cita = Number.isNaN(idSolicitud) ? null : await visitaModelo.buscarCita(idSolicitud, req.session.idUsuario);

    if (!cita) {
      return res.redirect('/visitas/agenda?msg=sin_cita');
    }

    const borrador = await visitaModelo.buscarBorrador(idSolicitud);
    const accion = ['borrador', 'confirmar', 'no_asistio'].includes(req.body.accion) ? req.body.accion : 'borrador';

    const { errores, datos } = leerFormulario(req.body, accion === 'confirmar');

    // En "no asistió" solo cuentan las observaciones: ni cargos, ni exámenes, ni recetas (FA-01)
    if (accion === 'no_asistio') {
      const errorObservaciones = errores.filter((e) => e.startsWith('Las observaciones'));

      if (errorObservaciones.length > 0) {
        return mostrarFormulario(req, res, cita, borrador, datos, errorObservaciones.join(' '));
      }
    } else if (errores.length > 0) {
      return mostrarFormulario(req, res, cita, borrador, datos, errores.join(' '));
    }

    const estado = { borrador: 'Borrador', confirmar: 'Registrada', no_asistio: 'No asistió' }[accion];
    const sinCargos = accion === 'no_asistio';

    const idVisita = await visitaModelo.guardar({
      id_visita: borrador ? borrador.id_visita : null,
      id_solicitud: cita.id_solicitud,
      id_interno: cita.id_interno,
      id_especialista: req.session.idUsuario,
      diagnostico: sinCargos ? null : datos.diagnostico || null,
      observaciones: datos.observaciones || null,
      costo_consulta: sinCargos ? 0 : datos.costo_consulta,
      costo_examenes: sinCargos ? 0 : datos.costo_examenes,
      examenes: sinCargos ? [] : datos.examenes,
      recetas: sinCargos ? [] : datos.recetas,
      estado
    });

    // null = la visita ya se cerró en otra pantalla, o la cita dejó de estar programada
    if (!idVisita) {
      return res.redirect('/visitas/agenda?msg=ya_cerrada');
    }

    if (accion === 'borrador') {
      return res.redirect(`/visitas/atender/${idSolicitud}?msg=borrador`);
    }

    if (accion === 'no_asistio') {
      return res.redirect('/visitas/agenda?msg=no_asistio');
    }

    // Se avisa a la Fundación que la cita ya se atendió. Si no responde no pasa nada:
    // queda pendiente de avisar y el sincronizador lo reintenta cada 5 minutos.
    sincronizador.notificarAtendida(cita.id_solicitud)
      .catch((error) => console.error(`Solicitud ${cita.id_solicitud}: pendiente de avisar a la Fundación (${error.message})`));

    // Visita registrada: se calcula el costo con el microservicio (FE-02: si no responde, queda pendiente)
    const visita = await visitaModelo.buscarPorId(idVisita);
    if (visita.estado_costo !== 'Pendiente de cálculo') {
      return res.redirect(`/visitas/${idVisita}?msg=registrada_sin_cargos`);
    }

    const calculado = await calculadorCostos.calcularVisita(visita);

    res.redirect(`/visitas/${idVisita}?msg=${calculado ? 'registrada' : 'costo_pendiente'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al guardar la visita');
  }
};

// Detalle de una visita: la ve su especialista, o quien tenga visitas:ver
exports.detalle = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const visita = Number.isNaN(id) ? null : await visitaModelo.buscarPorId(id);

    if (!visita) {
      return res.redirect(`${tienePermiso(res, 'visitas:ver') ? '/visitas' : '/visitas/agenda'}?msg=no_existe`);
    }

    const esMia = tienePermiso(res, 'visitas:atender') && visita.id_especialista === req.session.idUsuario;

    if (!tienePermiso(res, 'visitas:ver') && !esMia) {
      return res.status(403).render('sin-permiso', {
        titulo: 'Sin permiso',
        usuario: req.session.usuario,
        rol: req.session.rol
      });
    }

    const [examenes, recetas] = await Promise.all([
      visitaModelo.listarExamenes(id),
      visitaModelo.listarRecetas(id)
    ]);

    const aviso = MENSAJES.get(req.query.msg);

    res.render('visitas/detalle', {
      ...base(req, `Visita #${visita.id_visita}`),
      visita: {
        ...visita,
        clase_estado: CLASES_ESTADO[visita.estado] || 'text-bg-secondary',
        clase_costo: CLASES_COSTO[visita.estado_costo] || 'text-bg-secondary',
        hayCostos: visita.estado === 'Registrada' && visita.estado_costo !== 'Sin cargos',
        calculado: visita.estado_costo === 'Calculado'
      },
      examenes,
      recetas,
      esMia,
      // Anular un resultado equivocado: solo el especialista de esta visita (o el administrador)
      puedeAnular: visita.estado === 'Registrada' && tienePermiso(res, 'examenes:anular') && (esMia || res.locals.rolEsSistema),
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la visita');
  }
};
