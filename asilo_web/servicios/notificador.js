const nodemailer = require('nodemailer');
const correoModelo = require('../modelos/correoModelo');

// SERVICIO DE NOTIFICACIONES (CU-09, RN4, RN5)
// Nodemailer es el "cartero": arma el correo y lo entrega a la "oficina de correos" (el SMTP de Gmail).
// Reglas:
//   - NUNCA lanza errores hacia quien lo llama: si el correo falla, lo que se guardó (interno, solicitud) sigue guardado.
//   - Todo correo queda en la bitácora: Enviado, Pendiente (se reintenta solo), Sin correo (RN4) o Fallido.

const MAX_INTENTOS = 10;
const ZONA = 'America/Guatemala';   // en Azure el servidor está en hora UTC: las fechas se escriben en hora de Guatemala
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esCorreoValido = (c) => typeof c === 'string' && c.length <= 100 && REGEX_CORREO.test(c.trim());

// ===== El cartero (se crea una sola vez) =====
let cartero = null;
function obtenerCartero() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;   // correo no configurado en .env
  if (!cartero) {
    const puerto = Number(process.env.SMTP_PORT || 465);
    cartero = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: puerto,
      secure: puerto === 465,   // 465 = cifrado desde el inicio; 587 = se cifra después (STARTTLS)
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000
    });
  }
  return cartero;
}

// ===== Textos =====
// "LUIS RAUL LOPEZ" -> "Luis Raul Lopez" (en una carta se lee mejor que todo en mayúsculas)
function nombrePropio(texto) {
  return String(texto || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());
}

// Hoy, en palabras: "22 de octubre de 2026"
function hoyLargo() {
  return new Intl.DateTimeFormat('es-GT', { timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}

// '2026-10-26 10:30:00' (hora de Guatemala, como la guarda el asilo) -> "lunes, 26 de octubre de 2026 a las 10:30"
function fechaCitaLarga(sql) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(sql || ''));
  if (!m) return 'por confirmar';
  const dia = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));   // mediodía UTC: el día de la semana no se corre
  const fecha = new Intl.DateTimeFormat('es-GT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dia);
  return `${fecha} a las ${m[4]}:${m[5]}`;
}

// Cambia {hueco} por su valor; un hueco que no se conoce se deja tal cual (así se nota el error en la plantilla)
function rellenar(texto, valores) {
  return String(texto).replace(/\{(\w+)\}/g, (todo, clave) => (clave in valores ? String(valores[clave]) : todo));
}

const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plantilla institucional sencilla (CU-09 paso 5)
function html(asunto, cuerpo) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:#1f3b57;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold;">Asilo de Ancianos Cabeza de Algodón</td></tr>
      <tr><td style="padding:24px;color:#1e293b;font-size:15px;line-height:1.55;">
        <h2 style="margin:0 0 16px;font-size:17px;color:#1f3b57;">${escapar(asunto)}</h2>
        ${escapar(cuerpo).replace(/\n/g, '<br>')}
      </td></tr>
      <tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px;">
        Este es un aviso automático del sistema del asilo. Por favor no responda a este correo.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// ===== Envío de un correo de la bitácora =====
async function enviar(idCorreo) {
  const c = await correoModelo.buscar(idCorreo);
  if (!c || c.estado !== 'Pendiente') return c ? c.estado : null;

  const t = obtenerCartero();
  if (!t) {
    // Sin configuración no se gastan intentos: en cuanto se configure, se envía
    await correoModelo.marcarError(idCorreo, 'El correo del asilo no está configurado (SMTP_USER y SMTP_PASS en el .env).', false, MAX_INTENTOS);
    return 'Pendiente';
  }

  if (!(await correoModelo.tomar(idCorreo))) return null;   // otro proceso lo está enviando

  try {
    await t.sendMail({
      from: `"${process.env.CORREO_NOMBRE || 'Asilo Cabeza de Algodón'}" <${process.env.SMTP_USER}>`,
      to: c.destinatario,
      subject: c.asunto,
      text: c.cuerpo,
      html: html(c.asunto, c.cuerpo)
    });
    await correoModelo.marcarEnviado(idCorreo);
    return 'Enviado';
  } catch (error) {
    // FE-02: el servidor de correo no respondió o rechazó el envío -> queda pendiente y se reintenta
    await correoModelo.marcarError(idCorreo, error.message, true, MAX_INTENTOS);
    console.error(`Correo ${idCorreo}: no se pudo enviar (${error.message})`);
    error.idCorreo = idCorreo;
    throw error;
  }
}

// ===== Lo que llaman los módulos =====
// evento: la clave de la plantilla (ej. 'interno_ingreso')
// opciones: { idInterno, idFamiliar (para avisar a alguien que no es el responsable actual), valores: { especialidad, ... } }
// Devuelve { idCorreo, sinCorreo } (o null si la plantilla está apagada o algo falló). Nunca lanza errores.
async function notificar(evento, { idInterno, idFamiliar, valores = {} } = {}) {
  try {
    const plantilla = await correoModelo.plantilla(evento);
    if (!plantilla || !plantilla.activa) return null;

    const interno = idInterno ? await correoModelo.datosInterno(idInterno) : null;
    const destino = idFamiliar ? await correoModelo.datosFamiliar(idFamiliar) : interno;
    if (!destino) return null;

    const todos = {
      interno: nombrePropio(interno ? interno.interno : ''),
      familiar: nombrePropio(destino.familiar),
      fecha: hoyLargo(),
      ...valores
    };
    const valido = esCorreoValido(destino.correo);

    const idCorreo = await correoModelo.registrar({
      evento,
      id_interno: idInterno || null,
      id_familiar: destino.id_familiar,
      destinatario: valido ? destino.correo.trim() : null,
      asunto: rellenar(plantilla.asunto, todos).slice(0, 150),
      cuerpo: rellenar(plantilla.cuerpo, todos),
      estado: valido ? 'Pendiente' : 'Sin correo'   // RN4: se registra, pero no se envía
    });

    // Se envía "en segundo plano": no se espera a Gmail. Si falla, ya quedó "Pendiente" en la bitácora.
    if (valido) enviar(idCorreo).catch(() => {});
    return { idCorreo, sinCorreo: !valido };
  } catch (error) {
    console.error(`No se pudo registrar el correo "${evento}":`, error.message);
    return null;
  }
}

// Para usar sin esperar: el usuario no tiene que aguardar a que Gmail responda
function avisar(evento, opciones) {
  notificar(evento, opciones).catch(() => {});
}

// ===== Reintentos (cada 5 minutos desde app.js, y a mano desde la bitácora) =====
let reintentando = false;
async function reintentarPendientes() {
  if (reintentando) return;
  reintentando = true;
  try {
    await correoModelo.prepararReintentos(esCorreoValido);
    if (!obtenerCartero()) return;   // sin configuración no tiene caso intentar
    for (const id of await correoModelo.pendientes(MAX_INTENTOS, 20)) {
      try {
        await enviar(id);
      } catch (error) {
        break;   // si Gmail no responde, no se insiste con los demás en esta vuelta
      }
    }
  } catch (error) {
    console.error('Error al reintentar correos:', error.message);
  } finally {
    reintentando = false;
  }
}

// Reintento manual de UN correo: vuelve a leer el correo actual del familiar
async function reintentar(idCorreo) {
  const c = await correoModelo.buscar(idCorreo);
  if (!c) return null;
  const f = c.id_familiar ? await correoModelo.datosFamiliar(c.id_familiar) : null;
  const correo = f && esCorreoValido(f.correo) ? f.correo.trim() : null;
  if (!(await correoModelo.reiniciar(idCorreo, correo))) return c.estado;
  if (!correo) return 'Sin correo';
  try {
    return await enviar(idCorreo);
  } catch (error) {
    return 'Pendiente';
  }
}

const configurado = () => Boolean(obtenerCartero());

// Correo de prueba (para comprobar que Gmail está bien configurado). No va a la bitácora.
// Lanza el error de Gmail tal cual, para mostrarlo en pantalla.
async function probar(destino) {
  const t = obtenerCartero();
  if (!t) throw new Error('El correo del asilo no está configurado (SMTP_USER y SMTP_PASS en el .env).');
  const asunto = 'Correo de prueba del sistema del asilo';
  const cuerpo = `Si está leyendo esto, el envío de correos del sistema funciona.\n\nEnviado el ${hoyLargo()}.`;
  await t.sendMail({
    from: `"${process.env.CORREO_NOMBRE || 'Asilo Cabeza de Algodón'}" <${process.env.SMTP_USER}>`,
    to: destino, subject: asunto, text: cuerpo, html: html(asunto, cuerpo)
  });
}

module.exports = {
  notificar, avisar, reintentarPendientes, reintentar, configurado, probar, esCorreoValido,
  fechaCitaLarga, nombrePropio, rellenar, html, MAX_INTENTOS
};
