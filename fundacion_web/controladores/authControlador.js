const bcrypt = require('bcryptjs');
const usuarioModelo = require('../modelos/usuarioModelo');

exports.mostrarLogin = (req, res) => {
  res.render('login', { layout: false, error: null });
};

exports.procesarLogin = async (req, res) => {
  const usuario = String(req.body.usuario || '').trim();
  const clave = String(req.body.clave || '');

  try {
    const encontrado = await usuarioModelo.buscarPorUsuario(usuario);

    // Mismo mensaje para "no existe" y "clave incorrecta": no se le dice a un intruso cuál falló
    const coincide = encontrado ? await bcrypt.compare(clave, encontrado.contrasenia) : false;

    if (!coincide) {
      return res.render('login', { layout: false, error: 'Usuario o contraseña incorrectos' });
    }

    if (encontrado.estado !== 1) {
      return res.render('login', { layout: false, error: 'Esta cuenta está desactivada.' });
    }

    req.session.idUsuario = encontrado.id_usuario;
    req.session.usuario = encontrado.usuario;
    req.session.nombre = encontrado.nombre;

    res.redirect('/referencias');
  } catch (error) {
    console.error(error);
    res.render('login', { layout: false, error: 'Ocurrió un error al iniciar sesión' });
  }
};

exports.cerrarSesion = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};
