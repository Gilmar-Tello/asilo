const visitaModelo = require('../modelos/visitaModelo');

// Cliente del MICROSERVICIO DE COSTOS (D:\asilo\index.js, puerto 3000). Es el único que conoce el
// descuento institucional del 20% (RN1): el asilo solo le manda los importes y guarda lo que responde.
//
// Variable del .env (opcional): COSTOS_URL, por defecto http://127.0.0.1:3000
const URL_BASE = (process.env.COSTOS_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ESPERA_MS = 5000;

let reprocesando = false;   // para no empezar otra vuelta si la anterior sigue en marcha

// Pregunta el costo. Si el microservicio no responde, lanza el error (FE-02: la visita ya está guardada).
async function calcular({ consulta, examenes, medicamentos }) {
  const inicio = Date.now();
  let respuesta;

  try {
    respuesta = await fetch(`${URL_BASE}/calcular-costo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consulta, examenes, medicamentos }),
      signal: AbortSignal.timeout(ESPERA_MS)
    });
  } catch (error) {
    console.log(`[Costos] POST /calcular-costo -> sin respuesta (${Date.now() - inicio} ms)`);
    throw new Error('El microservicio de costos no responde');
  }

  console.log(`[Costos] POST /calcular-costo -> ${respuesta.status} (${Date.now() - inicio} ms)`);

  if (!respuesta.ok) {
    throw new Error(`El microservicio de costos respondió ${respuesta.status}`);
  }

  const datos = await respuesta.json();
  const subtotal = Number(datos.subtotal);
  const descuento = Number(datos.descuento);
  const total = Number(datos.total);

  // Nunca se guarda algo que no sea un número
  if (![subtotal, descuento, total].every(Number.isFinite)) {
    throw new Error('El microservicio de costos devolvió datos no válidos');
  }

  return { subtotal, descuento, total };
}

// Calcula y guarda el costo de una visita. Si el servicio no responde, no pasa nada:
// la visita queda "Pendiente de cálculo" y reprocesarPendientes() lo intenta después.
async function calcularVisita(visita) {
  try {
    const costos = await calcular({
      consulta: Number(visita.costo_consulta),
      examenes: Number(visita.costo_examenes),
      medicamentos: Number(visita.costo_medicamentos)
    });

    await visitaModelo.guardarCostos(visita.id_visita, costos);
    return true;
  } catch (error) {
    console.error(`Visita ${visita.id_visita}: costo pendiente de cálculo (${error.message})`);
    return false;
  }
}

// Se ejecuta cada pocos minutos (ver app.js)
async function reprocesarPendientes() {
  if (reprocesando) return;
  reprocesando = true;

  try {
    const pendientes = await visitaModelo.listarCostosPendientes();

    for (const visita of pendientes) {
      const bien = await calcularVisita(visita);

      // Si el servicio sigue caído, no se insiste con las demás
      if (!bien) break;
    }
  } catch (error) {
    console.error('Error al reprocesar costos:', error.message);
  } finally {
    reprocesando = false;
  }
}

module.exports = { calcular, calcularVisita, reprocesarPendientes };
