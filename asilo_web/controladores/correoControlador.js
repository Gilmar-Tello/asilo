const correoModelo = require('../modelos/correoModelo');
const notificador = require('../servicios/notificador');
const { texto } = require('../utilidades/texto');
const { leerFecha } = require('../utilidades/dinero');

const MENSAJES = new Map([
  ['plantilla',    { tipo: 'success', texto: 'Plantilla guardada. Los próximos correos usarán el texto nuevo.' }],
  ['reintentados', { tipo: 'success', texto: 'Se reintentaron los correos pendientes.' }],
  ['no_existe',    { tipo: 'danger',  texto: 'El registro no existe.' }]
]);

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });

function aviso(req) {
  const a = MENSAJES.get(req.query.msg);
  return { mensaje: a ? a.texto : null, tipo: a ? a.tipo : null };
}

// ===================== BITÁCORA =====================
async function pintarBitacora(req, res, mensaje, tipo) {
  const filtros = {
    estado: correoModelo.ESTADOS.includes(req.query.estado) ? req.query.estado : '',
    busqueda: String(req.query.q || '').trim().slice(0, 100),
    desde: leerFecha(req.query.desde),
    hasta: leerFecha(req.query.hasta)
  };
  if (filtros.desde && !filtros.hasta) filtros.hasta = filtros.desde;
  if (filtros.hasta && !filtros.desde) filtros.desde = filtros.hasta;
  if (filtros.desde > filtros.hasta) [filtros.desde, filtros.hasta] = [filtros.hasta, filtros.desde];

  const [lista, conteo] = await Promise.all([correoModelo.listar(filtros), correoModelo.conteo()]);

  res.render('correos/bitacora', {
    ...base(req, 'Correos a familiares'),
    lista: lista.map((c) => ({ ...c, reintentable: ['Pendiente', 'Sin correo', 'Fallido'].includes(c.estado) })),
    conteo: correoModelo.ESTADOS.filter((e) => e !== 'Enviando').map((e) => ({ estado: e, cantidad: conteo[e] || 0, activo: e === filtros.estado })),
    filtros: { ...filtros, desde: filtros.desde || '', hasta: filtros.hasta || '' },
    configurado: notificador.configurado(),
    remitente: process.env.SMTP_USER || '',
    mensaje, tipo
  });
}

exports.bitacora = async (req, res) => {
  try {
    const a = aviso(req);
    await pintarBitacora(req, res, a.mensaje, a.tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la bitácora de correos');
  }
};

exports.reintentar = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const estado = Number.isNaN(id) ? null : await notificador.reintentar(id);
    if (!estado) return res.redirect('/correos?msg=no_existe');

    const textos = {
      Enviado: ['success', 'Correo enviado.'],
      'Sin correo': ['warning', 'El familiar todavía no tiene un correo válido registrado. Agrégalo en Familiares responsables y vuelve a intentar.'],
      Pendiente: ['warning', 'No se pudo enviar todavía (revisa el detalle del error). Se volverá a intentar solo cada 5 minutos.']
    };
    const [tipo, mensaje] = textos[estado] || ['info', `Estado del correo: ${estado}.`];
    await pintarBitacora(req, res, mensaje, tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al reintentar el correo');
  }
};

exports.reintentarTodos = async (req, res) => {
  try {
    await notificador.reintentarPendientes();
    res.redirect('/correos?msg=reintentados');
  } catch (error) {
    console.error(error);
    res.send('Error al reintentar los correos');
  }
};

// Correo de prueba para comprobar la configuración de Gmail
exports.probar = async (req, res) => {
  try {
    const destino = String(req.body.destino || '').trim();
    if (!notificador.esCorreoValido(destino)) return pintarBitacora(req, res, 'Escribe un correo válido para la prueba.', 'danger');
    try {
      await notificador.probar(destino);
      await pintarBitacora(req, res, `Correo de prueba enviado a ${destino}. Revisa la bandeja de entrada (y la carpeta de spam).`, 'success');
    } catch (error) {
      await pintarBitacora(req, res, `No se pudo enviar la prueba: ${error.message}`, 'danger');
    }
  } catch (error) {
    console.error(error);
    res.send('Error al enviar la prueba');
  }
};

// ===================== PLANTILLAS =====================
exports.plantillas = async (req, res) => {
  try {
    res.render('correos/plantillas', { ...base(req, 'Plantillas de correo'), lista: await correoModelo.plantillas(), ...aviso(req) });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las plantillas');
  }
};

// Vista previa con datos de ejemplo, para ver cómo le llega al familiar
const EJEMPLO = {
  familiar: 'María López', interno: 'Juan Pérez', fecha: '22 de octubre de 2026',
  especialidad: 'Cardiología', fecha_cita: 'lunes, 26 de octubre de 2026 a las 10:30', especialista: 'Dr. Samuel Cabrican'
};

function pintarPlantilla(req, res, plantilla, mensaje) {
  const asunto = notificador.rellenar(plantilla.asunto, EJEMPLO);
  res.render('correos/plantilla', {
    ...base(req, `Plantilla: ${plantilla.nombre}`),
    plantilla,
    vistaPrevia: notificador.html(asunto, notificador.rellenar(plantilla.cuerpo, EJEMPLO)),
    mensaje, tipo: 'danger'
  });
}

exports.editarPlantilla = async (req, res) => {
  try {
    const p = await correoModelo.plantillaPorId(parseInt(req.params.id, 10) || 0);
    if (!p) return res.redirect('/correos/plantillas?msg=no_existe');
    pintarPlantilla(req, res, p, null);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la plantilla');
  }
};

exports.guardarPlantilla = async (req, res) => {
  try {
    const p = await correoModelo.plantillaPorId(parseInt(req.params.id, 10) || 0);
    if (!p) return res.redirect('/correos/plantillas?msg=no_existe');

    // OJO: aquí NO se pasa a mayúsculas. Es una carta para una persona: en mayúsculas se lee como si gritara.
    const datos = {
      asunto: texto(req.body.asunto),
      cuerpo: String(req.body.cuerpo || '').replace(/\r\n/g, '\n').trim(),
      activa: req.body.activa === '1'
    };

    // Solo se permiten los huecos de esta plantilla (un {hueco} mal escrito llegaría tal cual al familiar)
    const permitidos = p.variables.match(/\{\w+\}/g) || [];
    const usados = `${datos.asunto} ${datos.cuerpo}`.match(/\{[^}]*\}/g) || [];
    const raros = [...new Set(usados.filter((u) => !permitidos.includes(u)))];

    let error = null;
    if (datos.asunto.length < 5 || datos.asunto.length > 150) error = 'El asunto debe tener entre 5 y 150 caracteres.';
    else if (datos.cuerpo.length < 20 || datos.cuerpo.length > 5000) error = 'El mensaje debe tener entre 20 y 5000 caracteres.';
    else if (raros.length) error = `Estos huecos no existen en esta plantilla: ${raros.join(', ')}. Usa solo: ${p.variables}.`;

    if (error) return pintarPlantilla(req, res, { ...p, ...datos, activa: datos.activa ? 1 : 0 }, error);

    await correoModelo.guardarPlantilla(p.id_plantilla, datos);
    res.redirect('/correos/plantillas?msg=plantilla');
  } catch (error) {
    console.error(error);
    res.send('Error al guardar la plantilla');
  }
};
