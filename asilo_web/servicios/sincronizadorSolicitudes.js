const fundacion = require('./fundacionClient');
const solicitudModelo = require('../modelos/solicitudModelo');
const psicopatologiaModelo = require('../modelos/psicopatologiaModelo');

// Estados que puede devolver la Fundación. "Atendida" no está: lo pone el asilo al registrar la visita.
const ESTADOS_DE_LA_FUNDACION = [
  'Pendiente de Asignación',
  'En espera de disponibilidad',
  'Programada',
  'Reprogramada',
  'Rechazada'
];

let sincronizando = false;   // para no empezar otra vuelta si la anterior sigue en marcha

// Convierte la fecha que manda la Fundación a 'AAAA-MM-DD HH:MM:SS' (o null si no es válida)
function normalizarFecha(valor) {
  if (!valor) return null;

  const texto = String(valor).replace('T', ' ').slice(0, 19);

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(texto)) return null;

  return texto.length === 16 ? `${texto}:00` : texto;
}

// Envía una solicitud a la Fundación. Si ya tiene código, no la envía de nuevo.
// Si la Fundación no responde, lanza el error: la solicitud queda guardada sin código
// ("pendiente de enviar") y se reintenta después.
async function publicar(idSolicitud) {
  const solicitud = await solicitudModelo.buscarPorId(idSolicitud);

  if (!solicitud) {
    throw new Error('La solicitud no existe');
  }

  if (solicitud.codigo_fundacion) {
    return solicitud.codigo_fundacion;
  }

  const padecimientos = await psicopatologiaModelo.listarActivas(solicitud.id_interno);

  const respuesta = await fundacion.publicarReferencia({
    id_solicitud: solicitud.id_solicitud,
    interno: {
      nombre_completo: solicitud.interno_nombre,
      edad: solicitud.interno_edad,
      sexo: solicitud.interno_sexo
    },
    especialidad: solicitud.especialidad_requerida,
    es_externa: solicitud.es_externa === 1,
    evaluacion_inicial: solicitud.evaluacion_inicial,
    padecimientos
  });

  if (!respuesta || !respuesta.codigo) {
    throw new Error('La Fundación no devolvió un código');
  }

  const estado = ESTADOS_DE_LA_FUNDACION.includes(respuesta.estado)
    ? respuesta.estado
    : 'Pendiente de Asignación';

  await solicitudModelo.marcarPublicada(solicitud.id_solicitud, respuesta.codigo, estado);

  return respuesta.codigo;
}

// Pregunta a la Fundación cómo va la solicitud y guarda la respuesta.
// Si la Fundación no responde, lanza el error y NO se toca nada: se conserva el estado anterior.
async function consultar(idSolicitud) {
  const solicitud = await solicitudModelo.buscarPorId(idSolicitud);

  if (!solicitud || !solicitud.codigo_fundacion) {
    throw new Error('La solicitud todavía no se envió a la Fundación');
  }

  const respuesta = await fundacion.consultarReferencia(solicitud.codigo_fundacion);

  if (!respuesta || !ESTADOS_DE_LA_FUNDACION.includes(respuesta.estado)) {
    throw new Error('La Fundación devolvió un estado desconocido');
  }

  const fecha = normalizarFecha(respuesta.fecha_cita);
  const cambioDeFecha = Boolean(solicitud.fecha_cita_sql && fecha && solicitud.fecha_cita_sql !== fecha);
  const sigueAgendada = ['Programada', 'Reprogramada'].includes(respuesta.estado);

  await solicitudModelo.aplicarDeFundacion(solicitud.id_solicitud, {
    estado: respuesta.estado,
    fecha_cita: fecha,
    especialista_nombre: respuesta.especialista ? String(respuesta.especialista.nombre || '').slice(0, 100) || null : null,
    // id_externo = el id del especialista en el asilo: así sabemos de QUIÉN es la cita (agenda de visitas)
    id_especialista: respuesta.especialista && Number.parseInt(respuesta.especialista.id_externo, 10) > 0
      ? Number.parseInt(respuesta.especialista.id_externo, 10) : null,
    motivo_rechazo: respuesta.motivo_rechazo ? String(respuesta.motivo_rechazo).slice(0, 255) : null,
    // Si cambió la fecha o ya no está agendada, el enfermero asignado deja de valer
    desasignar: cambioDeFecha || !sigueAgendada
  });
}

// Avisa a la Fundación que la solicitud ya fue atendida (el especialista registró la visita).
// Si la Fundación no responde, lanza el error: queda "sin notificar" y se reintenta sola.
// Si la Fundación la rechaza por una razón que no se arregla reintentando (404 o 409), se anota y
// se da por cerrada: insistir cada 5 minutos no serviría de nada.
async function notificarAtendida(idSolicitud) {
  const solicitud = await solicitudModelo.buscarPorId(idSolicitud);

  if (!solicitud || !solicitud.codigo_fundacion || solicitud.estado !== 'Atendida') {
    return;
  }

  try {
    await fundacion.marcarAtendida(solicitud.codigo_fundacion);
  } catch (error) {
    // 404 solo cuenta si es "esa referencia no existe" (y no "esa ruta no existe", que pasaría
    // si la Fundación todavía no tiene esta versión): en ese caso sí hay que reintentar después
    const sinRemedio = error.estadoHttp === 409
      || (error.estadoHttp === 404 && error.message === 'Referencia no encontrada');

    if (error.noDisponible || !sinRemedio) {
      throw error;
    }
    console.error(`Solicitud ${idSolicitud}: la Fundación no pudo marcarla como atendida (${error.message})`);
  }

  await solicitudModelo.marcarAtendidaNotificada(idSolicitud);
}

// Se ejecuta cada pocos minutos (ver app.js): reenvía lo que no se pudo enviar y
// consulta el estado de lo que está pendiente.
async function sincronizarPendientes() {
  if (sincronizando) return;
  sincronizando = true;

  try {
    // Primero: las atendidas que la Fundación todavía no sabe
    for (const atendida of await solicitudModelo.listarAtendidasSinNotificar()) {
      try {
        await notificarAtendida(atendida.id_solicitud);
      } catch (error) {
        console.error(`Solicitud ${atendida.id_solicitud}: no se pudo avisar la atención (${error.message})`);
        if (error.noDisponible) break;
      }
    }

    const pendientes = await solicitudModelo.listarParaSincronizar();

    for (const pendiente of pendientes) {
      try {
        if (pendiente.codigo_fundacion) {
          await consultar(pendiente.id_solicitud);
        } else {
          await publicar(pendiente.id_solicitud);
        }
      } catch (error) {
        console.error(`Solicitud ${pendiente.id_solicitud}: ${error.message}`);

        // Si la Fundación no responde, no se insiste con las demás
        if (error.noDisponible) break;
      }
    }
  } catch (error) {
    console.error('Error al sincronizar solicitudes:', error.message);
  } finally {
    sincronizando = false;
  }
}

module.exports = { publicar, consultar, notificarAtendida, sincronizarPendientes };
