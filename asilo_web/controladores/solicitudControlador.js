const solicitudModelo = require('../modelos/solicitudModelo');
const internoModelo = require('../modelos/internoModelo');
const psicopatologiaModelo = require('../modelos/psicopatologiaModelo');
const fundacion = require('../servicios/fundacionClient');
const sincronizador = require('../servicios/sincronizadorSolicitudes');
const { texto, mayus, mayusParrafo } = require('../utilidades/texto');

// Regla RN6: solo el Médico General crea solicitudes de referencia.
// Si lo pones en true, el administrador también podrá (útil mientras pruebas).
const PERMITIR_AL_ADMINISTRADOR = false;

// Los seis estados de la regla RN3
const ESTADOS = [
  'Pendiente de Asignación',
  'En espera de disponibilidad',
  'Programada',
  'Reprogramada',
  'Rechazada',
  'Atendida'
];

// Color de la insignia de cada estado (clases de Bootstrap)
const CLASES_ESTADO = {
  'Pendiente de Asignación':     'text-bg-warning',
  'En espera de disponibilidad': 'text-bg-secondary',
  'Programada':                  'text-bg-success',
  'Reprogramada':                'text-bg-primary',
  'Rechazada':                   'text-bg-danger',
  'Atendida':                    'text-bg-dark'
};

const AGENDADAS = ['Programada', 'Reprogramada'];

// Mensajes fijos que viajan por la URL (?msg=...)
const MENSAJES = new Map([
  ['creada',      { tipo: 'success', texto: 'Solicitud creada y enviada a la Fundación.' }],
  ['enviada',     { tipo: 'success', texto: 'Solicitud enviada a la Fundación.' }],
  ['sincronizada',{ tipo: 'success', texto: 'Estado actualizado desde la Fundación.' }],
  ['enfermero',   { tipo: 'success', texto: 'Enfermero asignado correctamente.' }],
  ['no_existe',   { tipo: 'danger',  texto: 'La solicitud no existe.' }],
  ['solo_medico', { tipo: 'danger',  texto: 'Solo el médico general puede crear solicitudes de referencia.' }],
  ['fundacion',   { tipo: 'danger',  texto: 'No se pudo comunicar con la Fundación. Se conserva la información anterior; intenta de nuevo más tarde.' }],
  ['no_publicada',{ tipo: 'warning', texto: 'La solicitud se guardó, pero la Fundación no está disponible: quedó pendiente de enviar. Se reintentará sola, o usa el botón "Enviar a la Fundación".' }],
  ['sin_cita',    { tipo: 'danger',  texto: 'Solo se puede asignar enfermero cuando la solicitud tiene una cita programada.' }],
  ['enfermero_no_valido', { tipo: 'danger', texto: 'Ese enfermero no está disponible para esa cita.' }]
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// ¿Puede ver TODAS las solicitudes? (si no, solo ve las que tiene asignadas)
function veTodas(res) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes('solicitudes:ver');
}

function tienePermiso(res, clave) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes(clave);
}

// RN6: crear solicitudes. Aquí NO vale el pase libre del administrador (salvo la constante de arriba).
function puedeCrear(res) {
  if (res.locals.rolEsSistema) return PERMITIR_AL_ADMINISTRADOR;
  return res.locals.misPermisos.includes('solicitudes:crear');
}

// Especialidades que atiende la Fundación. Si no responde, el formulario sigue funcionando con "Otra".
async function cargarEspecialidades() {
  try {
    const especialidades = await fundacion.listarEspecialidades();

    // Sin especialistas registrados en el asilo no hay especialidades que ofrecer
    const avisoVacio = especialidades.length === 0 && !fundacion.SIMULADO
      ? 'Todavía no hay médicos especialistas registrados en el asilo (usuarios con rol de médico especialista y su especialidad). Mientras tanto puedes escribir la especialidad en "Otra".'
      : null;

    return { especialidades, avisoCatalogo: avisoVacio };
  } catch (error) {
    return {
      especialidades: [],
      avisoCatalogo: 'No se pudo consultar el catálogo de especialidades de la Fundación. Puedes escribir la especialidad en "Otra".'
    };
  }
}

// Lista de solicitudes (el enfermero solo ve las suyas)
exports.listar = async (req, res) => {
  try {
    const todas = veTodas(res);
    const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : '';

    const filas = await solicitudModelo.listar({
      idEnfermero: todas ? null : req.session.idUsuario,
      estado
    });

    const lista = filas.map((s) => ({
      ...s,
      clase_estado: CLASES_ESTADO[s.estado] || 'text-bg-secondary',
      // RN8: una cita programada necesita enfermero que acompañe
      falta_enfermero: AGENDADAS.includes(s.estado) && !s.id_enfermero_asignado
    }));

    const aviso = MENSAJES.get(req.query.msg);

    res.render('solicitudes/listar', {
      ...base(req, todas ? 'Solicitudes' : 'Mis acompañamientos'),
      lista,
      estado,
      estados: ESTADOS,
      veTodas: todas,
      puedeCrear: puedeCrear(res),
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las solicitudes');
  }
};

// Formulario de solicitud nueva
exports.mostrarCrear = async (req, res) => {
  try {
    if (!puedeCrear(res)) {
      return res.redirect('/solicitudes?msg=solo_medico');
    }

    const { especialidades, avisoCatalogo } = await cargarEspecialidades();

    res.render('solicitudes/formulario', {
      ...base(req, 'Nueva solicitud'),
      especialidades,
      avisoCatalogo,
      modoSimulado: fundacion.SIMULADO,
      solicitudForm: {},
      internoElegido: null,
      enlaceFicha: null,
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario');
  }
};

// Busca internos activos para el buscador del formulario (devuelve JSON)
exports.buscarInternos = async (req, res) => {
  const texto = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (texto.length < 2) {
    return res.json([]);
  }

  try {
    res.json(await internoModelo.buscarActivos(texto));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al buscar' });
  }
};

// Guarda la solicitud y la envía a la Fundación
exports.crear = async (req, res) => {
  try {
    if (!puedeCrear(res)) {
      return res.redirect('/solicitudes?msg=solo_medico');
    }

    const idInterno = parseInt(req.body.id_interno, 10);
    const esOtra = req.body.especialidad === '__otra__';
    // Regla del proyecto: el texto libre va en MAYÚSCULAS. El valor de la lista (select) se deja tal cual:
    // viene del catálogo de la Fundación, y "__otra__" es una señal interna que el código compara.
    const especialidad = esOtra ? mayus(req.body.especialidad_otra) : texto(req.body.especialidad);
    const evaluacion = mayusParrafo(req.body.evaluacion_inicial);

    const { especialidades, avisoCatalogo } = await cargarEspecialidades();
    const internoElegido = Number.isNaN(idInterno) ? null : await internoModelo.buscarFicha(idInterno);

    // Vuelve a mostrar el formulario conservando lo que se escribió
    const volver = (mensaje, enlaceFicha) => res.render('solicitudes/formulario', {
      ...base(req, 'Nueva solicitud'),
      especialidades,
      avisoCatalogo,
      modoSimulado: fundacion.SIMULADO,
      solicitudForm: {
        especialidad: req.body.especialidad,
        especialidad_otra: especialidad && esOtra ? especialidad : '',
        evaluacion_inicial: evaluacion
      },
      internoElegido,
      enlaceFicha: enlaceFicha || null,
      mensaje
    });

    if (!internoElegido) {
      return volver('Busca y elige un interno de la lista.');
    }
    if (internoElegido.estado !== 1) {
      return volver('El interno elegido está desactivado.');
    }
    if (!especialidad || especialidad.length > 50) {
      return volver('Elige la especialidad requerida, o escríbela en "Otra" (máximo 50 caracteres).');
    }
    if (evaluacion.length < 10 || evaluacion.length > 2000) {
      return volver('La evaluación inicial debe tener entre 10 y 2000 caracteres.');
    }

    // Para derivar a un interno hace falta saber qué padece (FA-02 del CU-01)
    const padecimientos = await psicopatologiaModelo.contarActivas(internoElegido.id_interno);
    if (padecimientos === 0) {
      return volver(
        'Antes de derivar, registra al menos un padecimiento vigente de este interno.',
        `/padecimientos/interno/${internoElegido.id_interno}`
      );
    }

    const idNueva = await solicitudModelo.crear({
      id_interno: internoElegido.id_interno,
      id_medico_general: req.session.idUsuario,
      especialidad_requerida: especialidad,
      es_externa: esOtra ? 1 : 0,
      evaluacion_inicial: evaluacion
    });

    // Se envía a la Fundación. Si no responde, la solicitud ya quedó guardada.
    try {
      await sincronizador.publicar(idNueva);
    } catch (error) {
      console.error(`Solicitud ${idNueva} sin enviar:`, error.message);
      return res.redirect(`/solicitudes/${idNueva}?msg=no_publicada`);
    }

    res.redirect(`/solicitudes/${idNueva}?msg=creada`);
  } catch (error) {
    console.error(error);
    res.send('Error al crear la solicitud');
  }
};

// Detalle de una solicitud
exports.detalle = async (req, res) => {
  try {
    const todas = veTodas(res);
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {
      return res.redirect('/solicitudes?msg=no_existe');
    }

    // El enfermero solo encuentra las suyas: para él las demás "no existen"
    let solicitud = await solicitudModelo.buscarPorId(id, todas ? null : req.session.idUsuario);

    if (!solicitud) {
      return res.redirect('/solicitudes?msg=no_existe');
    }

    // Si el dato tiene más de un minuto, se intenta refrescar desde la Fundación.
    // Si ella no responde, se muestra lo último que se sabía.
    let avisoSincronizacion = null;
    const viva = solicitudModelo.ESTADOS_ACTIVOS.includes(solicitud.estado);
    const desactualizada = solicitud.segundos_sin_sincronizar === null || solicitud.segundos_sin_sincronizar > 60;

    if (todas && solicitud.codigo_fundacion && viva && desactualizada) {
      try {
        await sincronizador.consultar(id);
        solicitud = await solicitudModelo.buscarPorId(id);
      } catch (error) {
        avisoSincronizacion = 'No se pudo consultar a la Fundación: se muestra la última información conocida.';
      }
    }

    const agendada = AGENDADAS.includes(solicitud.estado) && Boolean(solicitud.fecha_cita_sql);
    const puedeAsignar = tienePermiso(res, 'solicitudes:asignar_enfermero');
    const puedeSincronizar = tienePermiso(res, 'solicitudes:sincronizar');

    let padecimientos = [];
    let enfermeros = [];

    if (todas) {
      padecimientos = await psicopatologiaModelo.listarPorInterno(solicitud.id_interno);
    }

    if (puedeAsignar && agendada) {
      enfermeros = await solicitudModelo.listarEnfermerosDisponibles(solicitud.id_solicitud, solicitud.fecha_cita_sql);
    }

    // El enfermero solo ve lo que necesita para acompañar: nada de evaluación clínica
    const vista = todas
      ? solicitud
      : { ...solicitud, evaluacion_inicial: undefined, medico_nombre: undefined, codigo_fundacion: undefined };

    const aviso = MENSAJES.get(req.query.msg);

    res.render('solicitudes/detalle', {
      ...base(req, `Solicitud #${solicitud.id_solicitud}`),
      solicitud: { ...vista, clase_estado: CLASES_ESTADO[solicitud.estado] || 'text-bg-secondary' },
      veTodas: todas,
      padecimientos,
      enfermeros: enfermeros.map((e) => ({
        ...e,
        asignado: e.id_usuario === solicitud.id_enfermero_asignado
      })),
      agendada,
      puedeAsignar,
      puedeSincronizar,
      modoSimulado: fundacion.SIMULADO,
      mensaje: avisoSincronizacion || (aviso ? aviso.texto : null),
      tipo: avisoSincronizacion ? 'warning' : (aviso ? aviso.tipo : null)
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la solicitud');
  }
};

// Botón "Consultar a la Fundación" / "Enviar a la Fundación"
exports.sincronizar = async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const solicitud = Number.isNaN(id) ? null : await solicitudModelo.buscarPorId(id);

    if (!solicitud) {
      return res.redirect('/solicitudes?msg=no_existe');
    }

    if (solicitud.codigo_fundacion) {
      await sincronizador.consultar(id);
      return res.redirect(`/solicitudes/${id}?msg=sincronizada`);
    }

    await sincronizador.publicar(id);
    res.redirect(`/solicitudes/${id}?msg=enviada`);
  } catch (error) {
    console.error(`Solicitud ${id}:`, error.message);
    res.redirect(`/solicitudes/${id}?msg=fundacion`);
  }
};

// El administrador asigna al enfermero que acompañará la cita
exports.asignarEnfermero = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const idEnfermero = parseInt(req.body.id_enfermero, 10);

    const solicitud = Number.isNaN(id) ? null : await solicitudModelo.buscarPorId(id);

    if (!solicitud) {
      return res.redirect('/solicitudes?msg=no_existe');
    }

    // Solo con cita programada: sin fecha y hora no se sabe quién está libre
    if (!AGENDADAS.includes(solicitud.estado) || !solicitud.fecha_cita_sql) {
      return res.redirect(`/solicitudes/${id}?msg=sin_cita`);
    }

    // El servidor vuelve a comprobar que esté disponible: el formulario se puede manipular
    const disponibles = await solicitudModelo.listarEnfermerosDisponibles(id, solicitud.fecha_cita_sql);

    if (Number.isNaN(idEnfermero) || !disponibles.some((e) => e.id_usuario === idEnfermero)) {
      return res.redirect(`/solicitudes/${id}?msg=enfermero_no_valido`);
    }

    await solicitudModelo.asignarEnfermero(id, idEnfermero);

    res.redirect(`/solicitudes/${id}?msg=enfermero`);
  } catch (error) {
    console.error(error);
    res.send('Error al asignar el enfermero');
  }
};
