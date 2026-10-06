const bcrypt = require('bcryptjs');
const usuarioModelo = require('../modelos/usuarioModelo');

// Muestra la pantalla de login
exports.mostrarLogin = (req, res) => {
  res.render('login', { layout: false, error: null });
};

// Procesa el login contra la base de datos
exports.procesarLogin = async (req, res) => {
  const { usuario, clave } = req.body;

  try {
    const encontrado = await usuarioModelo.buscarPorUsuario(usuario);

    // Usuario inexistente o contraseña incorrecta: mismo mensaje
    if (!encontrado || !(await bcrypt.compare(clave, encontrado.contrasenia))) {
      return res.render('login', {
        layout: false,
        error: 'Usuario o contraseña incorrectos'
      });
    }

    if (encontrado.estado !== 1) {
      return res.render('login', {
        layout: false,
        error: 'Esta cuenta está desactivada. Contacta al administrador.'
      });
    }

    // Datos que viajan en la sesión
    req.session.idUsuario = encontrado.id_usuario;
    req.session.usuario   = encontrado.usuario;
    req.session.rol       = encontrado.rol;
    req.session.nombre    = `${encontrado.nombre1} ${encontrado.apellido1}`;

    res.redirect('/dashboard');

  } catch (error) {
    console.error(error);
    res.render('login', { layout: false, error: 'Ocurrió un error al iniciar sesión' });
  }
};

exports.mostrarDashboard = (req, res) => {
  res.render('dashboard', {
    titulo: 'Dashboard',
    usuario: req.session.usuario,
    rol: req.session.rol
  });
};

exports.cerrarSesion = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};