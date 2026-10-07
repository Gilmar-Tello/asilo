// Cliente de la API de la Fundación.
//
// El asilo y la Fundación son dos sistemas separados: no comparten base de datos ni código,
// solo se hablan por esta API (como enviar un paquete: se recibe un número de guía y después
// se consulta el seguimiento con ese número).
//
// Variables del .env (todas opcionales mientras se desarrolla):
//   FUNDACION_URL      -> dirección de la Fundación, por ejemplo http://localhost:3002
//   FUNDACION_API_KEY  -> clave compartida; viaja en la cabecera X-API-KEY
//   FUNDACION_MODO     -> 'simulado' fuerza el modo simulado aunque exista FUNDACION_URL
//
// MODO SIMULADO: si no hay FUNDACION_URL, las respuestas son de mentira. Sirve para probar
// todo el asilo sin tener la Fundación encendida. El resultado depende del número de la
// solicitud: id 1, 4, 7... => Programada; id 2, 5, 8... => En espera; id 3, 6, 9... => Rechazada.

const URL_BASE = (process.env.FUNDACION_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.FUNDACION_API_KEY || '';
const SIMULADO = !URL_BASE || process.env.FUNDACION_MODO === 'simulado';
const ESPERA_MS = 5000;   // si la Fundación no responde en 5 segundos, se da por no disponible

// Error para "no hay comunicación con la Fundación" (apagada, sin red, error del servidor)
class FundacionNoDisponible extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.noDisponible = true;
  }
}

// Hace la llamada HTTP real
async function llamar(metodo, ruta, cuerpo) {
  let respuesta;
  const inicio = Date.now();

  try {
    respuesta = await fetch(URL_BASE + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(ESPERA_MS)
    });
  } catch (error) {
    console.log(`[Fundación] ${metodo} ${ruta} -> sin respuesta (${Date.now() - inicio} ms)`);
    throw new FundacionNoDisponible('No se pudo conectar con la Fundación');
  }

  // Bitácora: cada llamada a la Fundación queda escrita en la consola (sin clave ni datos de pacientes)
  console.log(`[Fundación] ${metodo} ${ruta} -> ${respuesta.status} (${Date.now() - inicio} ms)`);

  if (respuesta.status >= 500) {
    throw new FundacionNoDisponible(`La Fundación respondió con error ${respuesta.status}`);
  }

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch (error) {
    // la respuesta no traía JSON
  }

  if (!respuesta.ok) {
    const error = new Error((datos && datos.mensaje) || `La Fundación rechazó la petición (${respuesta.status})`);
    error.estadoHttp = respuesta.status;
    throw error;
  }

  return datos;
}

// Fecha como 'AAAA-MM-DD' (hora local)
function aTexto(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// Respuesta de mentira para el modo simulado
function simularConsulta(codigo) {
  const numero = parseInt(String(codigo).replace('SIM-', ''), 10) || 0;
  const resto = numero % 3;

  if (resto === 1) {
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return {
      estado: 'Programada',
      fecha_cita: `${aTexto(manana)} 09:00:00`,
      especialista: { nombre: 'Dr. Simulado', especialidad: 'Geriatría' },
      motivo_rechazo: null
    };
  }

  if (resto === 2) {
    return { estado: 'En espera de disponibilidad', fecha_cita: null, especialista: null, motivo_rechazo: null };
  }

  return {
    estado: 'Rechazada',
    fecha_cita: null,
    especialista: null,
    motivo_rechazo: 'Información insuficiente (respuesta simulada)'
  };
}

// Envía la solicitud a la Fundación. Devuelve { codigo, estado }.
// Es seguro repetirla: la Fundación reconoce el id_solicitud y devuelve el mismo código.
async function publicarReferencia(solicitud) {
  if (SIMULADO) {
    return { codigo: `SIM-${solicitud.id_solicitud}`, estado: 'Pendiente de Asignación' };
  }
  return llamar('POST', '/api/referencias', solicitud);
}

// Consulta el seguimiento de una referencia
// Devuelve { estado, fecha_cita, especialista: { nombre, especialidad } | null, motivo_rechazo }
async function consultarReferencia(codigo) {
  if (SIMULADO) {
    return simularConsulta(codigo);
  }
  return llamar('GET', `/api/referencias/${encodeURIComponent(codigo)}`);
}

// Avisa a la Fundación que el especialista ya atendió al interno (la referencia pasa a "Atendida").
// Es seguro repetirla: si ya estaba atendida, la Fundación responde lo mismo.
async function marcarAtendida(codigo) {
  if (SIMULADO) {
    return { codigo, estado: 'Atendida', simulado: true };
  }
  return llamar('PUT', `/api/referencias/${encodeURIComponent(codigo)}/atendida`);
}

// Catálogo de especialidades que atiende la Fundación
async function listarEspecialidades() {
  if (SIMULADO) {
    return ['Cardiología', 'Geriatría', 'Neurología', 'Psiquiatría', 'Traumatología'];
  }

  const datos = await llamar('GET', '/api/especialidades');
  return Array.isArray(datos) ? datos : [];
}

// Manda a la Fundación la lista COMPLETA de los médicos especialistas del asilo.
// lista: [{ id_externo, nombre_completo, especialidad }]. Quien falte en la lista queda desactivado allá.
async function sincronizarEspecialistas(lista) {
  if (SIMULADO) {
    return { recibidos: lista.length, simulado: true };
  }
  return llamar('PUT', '/api/especialistas', { especialistas: lista });
}

module.exports = {
  SIMULADO, FundacionNoDisponible,
  publicarReferencia, consultarReferencia, marcarAtendida, listarEspecialidades, sincronizarEspecialistas
};
