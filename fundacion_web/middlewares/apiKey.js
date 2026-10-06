const crypto = require('crypto');

// Protege la API: el asilo debe mandar la clave compartida en la cabecera X-API-KEY.
// Se compara con timingSafeEqual para no filtrar la clave por diferencias de tiempo.
exports.exigirApiKey = (req, res, next) => {
  const esperada = process.env.API_KEY;

  if (!esperada) {
    return res.status(503).json({ mensaje: 'La API no está configurada (falta API_KEY en el .env)' });
  }

  const recibida = Buffer.from(String(req.get('x-api-key') || ''));
  const correcta = Buffer.from(esperada);

  const coincide = recibida.length === correcta.length && crypto.timingSafeEqual(recibida, correcta);

  if (!coincide) {
    return res.status(401).json({ mensaje: 'Clave de API incorrecta' });
  }

  next();
};
