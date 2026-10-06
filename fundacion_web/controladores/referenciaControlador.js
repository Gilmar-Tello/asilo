const referenciaModelo = require('../modelos/referenciaModelo');
const especialistaModelo = require('../modelos/especialistaModelo');

const ESTADOS = [
  'Pendiente de Asignación',
  'En espera de disponibilidad',
  'Programada',
  'Reprogramada',
  'Rechazada',
  'Atendida'
];

const CLASES_ESTADO = {
  'Pendiente de Asignación':     'text-bg-warning',
  'En espera de disponibilidad': 'text-bg-secondary',
  'Programada':                  'text-bg-success',
  'Reprogramada':                'text-bg-primary',
  'Rechazada':                   'text-bg-danger',
  'Atendida':                    'text-bg-dark'
};

// Qué puede hacer el personal de la Fundación según el estado de la referencia (CU-03)
const PUEDE_PROGRAMAR   = ['Pendiente de Asignación', 'En espera de disponibilidad'];
const PUEDE_ESPERAR     = ['Pendiente de Asignación'];
const PUEDE_RECHAZAR    = ['Pendiente de Asignación', 'En espera de disponibilidad'];
const PUEDE_REPROGRAMAR = ['Programada', 'Reprogramada'];

// Mensajes fijos que viajan por la URL (?msg=...)
const MENSAJES = new Map([
  ['programada',   { tipo: 'success', texto: 'Cita programada. El asilo verá el cambio en su próxima consulta.' }],
  ['reprogramada', { tipo: 'success', texto: 'Cita reprogramada. El asilo verá el cambio en su próxima consulta.' }],
  ['espera',       { tipo: 'success', texto: 'La referencia quedó en espera de disponibilidad.' }],
  ['rechazada',    { tipo: 'success', texto: 'Referencia rechazada. El asilo verá el motivo en su próxima consulta.' }],
  ['no_existe',    { tipo: 'danger',  texto: 'La referencia no existe.' }],
  ['estado_no_permite', { tipo: 'danger', texto: 'Esa acción no corresponde al estado actual de la referencia.' }],
  ['fecha_invalida',    { tipo: 'danger', texto: 'La fecha y hora no son válidas.' }],
  ['fecha_pasada',      { tipo: 'danger', texto: 'La cita debe ser en el futuro.' }],
  ['fecha_lejana',      { tipo: 'danger', texto: 'La cita no puede ser a más de un año.' }],
  ['especialista_invalido', { tipo: 'danger', texto: 'Elige un especialista activo de la especialidad que se pidió.' }],
  ['conflicto',         { tipo: 'danger', texto: 'Ese especialista ya tiene otra cita a menos de 1 hora de esa fecha y hora. Elige otra.' }],
  ['motivo_corto',      { tipo: 'danger', texto: 'Explica el motivo del rechazo (entre 10 y 255 caracteres).' }],
  ['sin_cambios',       { tipo: 'danger', texto: 'La nueva cita es igual a la actual: cambia la fecha o el especialista.' }]
]);

const base = (req, titulo) => ({ titulo, nombre: req.session.nombre });

// Lee y valida la fecha y el especialista que llegan del formulario.
// Devuelve { error: 'clave' } o { fechaSql, especialista }.
async function leerCita(body, referencia) {
  const texto = String(body.fecha || '').trim();   // viene como AAAA-MM-DDTHH:MM

  const fecha = new Date(texto);
  const pad = (n) => String(n).padStart(2, '0');

  // Se reconstruye el texto desde la fecha para rechazar cosas como 31 de febrero
  const reconstruido = Number.isNaN(fecha.getTime())
    ? ''
    : `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto) || reconstruido !== texto) {
    return { error: 'fecha_invalida' };
  }
  if (fecha.getTime() <= Date.now()) {
    return { error: 'fecha_pasada' };
  }
  if (fecha.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    return { error: 'fecha_lejana' };
  }

  const idEspecialista = Number.parseInt(body.id_especialista, 10);

  // La base de datos comprueba que sea un especialista activo de ESA especialidad
  // (ignora mayúsculas y tildes; comparar el texto aquí fallaba con "Cardiología" contra "CARDIOLOGIA")
  const especialista = Number.isNaN(idEspecialista)
    ? null
    : await especialistaModelo.buscarActivoPorId(idEspecialista, referencia.especialidad);

  if (!especialista) {
    return { error: 'especialista_invalido' };
  }

  const fechaSql = texto.replace('T', ' ') + ':00';

  if (await especialistaModelo.tieneCitaCerca(especialista.id_especialista, fechaSql, referencia.id_referencia)) {
    return { error: 'conflicto' };
  }

  return { fechaSql, especialista };
}

// Lista de referencias, con filtro por estado
exports.listar = async (req, res) => {
  try {
    const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : '';
    const filas = await referenciaModelo.listar(estado);

    const lista = filas.map((r) => ({
      ...r,
      clase_estado: CLASES_ESTADO[r.estado] || 'text-bg-secondary',
      requiere_atencion: PUEDE_PROGRAMAR.includes(r.estado)
    }));

    res.render('referencias/listar', {
      ...base(req, 'Referencias'),
      lista,
      estado,
      estados: ESTADOS
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las referencias');
  }
};

// Detalle de una referencia, con las acciones que corresponden a su estado
exports.detalle = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.redirect('/referencias');
    }

    let padecimientos = [];
    try {
      padecimientos = JSON.parse(referencia.padecimientos || '[]');
    } catch (error) {
      padecimientos = [];
    }
    if (!Array.isArray(padecimientos)) padecimientos = [];

    const puedeProgramar = PUEDE_PROGRAMAR.includes(referencia.estado);
    const puedeReprogramar = PUEDE_REPROGRAMAR.includes(referencia.estado);

    let especialistas = [];
    if (puedeProgramar || puedeReprogramar) {
      especialistas = await especialistaModelo.listarActivosPorEspecialidad(referencia.especialidad);
    }

    const aviso = MENSAJES.get(req.query.msg);

    res.render('referencias/detalle', {
      ...base(req, `Referencia ${referencia.codigo}`),
      referencia: { ...referencia, clase_estado: CLASES_ESTADO[referencia.estado] || 'text-bg-secondary' },
      padecimientos,
      especialistas: especialistas.map((e) => ({ ...e, actual: e.id_especialista === referencia.id_especialista })),
      sinEspecialistas: (puedeProgramar || puedeReprogramar) && especialistas.length === 0,
      puedeProgramar,
      puedeReprogramar,
      puedeEsperar: PUEDE_ESPERAR.includes(referencia.estado),
      puedeRechazar: PUEDE_RECHAZAR.includes(referencia.estado),
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la referencia');
  }
};

// Programa la primera cita
exports.programar = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.redirect('/referencias');
    }

    const volver = (clave) => res.redirect(`/referencias/${referencia.codigo}?msg=${clave}`);

    if (!PUEDE_PROGRAMAR.includes(referencia.estado)) {
      return volver('estado_no_permite');
    }

    const cita = await leerCita(req.body, referencia);

    if (cita.error) {
      return volver(cita.error);
    }

    await referenciaModelo.programar(referencia.id_referencia, {
      estado: 'Programada',
      fecha_cita: cita.fechaSql,
      id_especialista: cita.especialista.id_especialista
    });

    volver('programada');
  } catch (error) {
    console.error(error);
    res.send('Error al programar la cita');
  }
};

// Cambia la fecha o el especialista de una cita ya programada
exports.reprogramar = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.redirect('/referencias');
    }

    const volver = (clave) => res.redirect(`/referencias/${referencia.codigo}?msg=${clave}`);

    if (!PUEDE_REPROGRAMAR.includes(referencia.estado)) {
      return volver('estado_no_permite');
    }

    const cita = await leerCita(req.body, referencia);

    if (cita.error) {
      return volver(cita.error);
    }

    if (cita.fechaSql === referencia.fecha_cita && cita.especialista.id_especialista === referencia.id_especialista) {
      return volver('sin_cambios');
    }

    await referenciaModelo.programar(referencia.id_referencia, {
      estado: 'Reprogramada',
      fecha_cita: cita.fechaSql,
      id_especialista: cita.especialista.id_especialista
    });

    volver('reprogramada');
  } catch (error) {
    console.error(error);
    res.send('Error al reprogramar la cita');
  }
};

// No hay especialista libre: queda en espera de disponibilidad
exports.esperar = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.redirect('/referencias');
    }

    if (!PUEDE_ESPERAR.includes(referencia.estado)) {
      return res.redirect(`/referencias/${referencia.codigo}?msg=estado_no_permite`);
    }

    await referenciaModelo.ponerEnEspera(referencia.id_referencia);

    res.redirect(`/referencias/${referencia.codigo}?msg=espera`);
  } catch (error) {
    console.error(error);
    res.send('Error al poner la referencia en espera');
  }
};

// Información insuficiente: se rechaza con un motivo que el asilo podrá leer
exports.rechazar = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.redirect('/referencias');
    }

    const volver = (clave) => res.redirect(`/referencias/${referencia.codigo}?msg=${clave}`);

    if (!PUEDE_RECHAZAR.includes(referencia.estado)) {
      return volver('estado_no_permite');
    }

    // Regla del proyecto: el texto libre va en MAYÚSCULAS
    const motivo = String(req.body.motivo || '').trim().replace(/\s+/g, ' ').toUpperCase();

    if (motivo.length < 10 || motivo.length > 255) {
      return volver('motivo_corto');
    }

    await referenciaModelo.rechazar(referencia.id_referencia, motivo);

    volver('rechazada');
  } catch (error) {
    console.error(error);
    res.send('Error al rechazar la referencia');
  }
};
