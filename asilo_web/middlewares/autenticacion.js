const usuarioModelo = require('../modelos/usuarioModelo');
const rolModelo = require('../modelos/rolModelo');

// Que haya una sesión iniciada
exports.requiereLogin = (req, res, next) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  next();
};

// Ya no se usa en las rutas (se reemplazó por requierePermiso); se deja por si acaso
exports.requiereAdmin = (req, res, next) => {
  if (req.session.rol !== 'administrador') {
    return res.status(403).send('Acceso denegado: solo administradores');
  }
  next();
};

// Se ejecuta en CADA petición, antes de las rutas (se registra en app.js).
// Vuelve a leer de la base el estado del usuario y los permisos de su rol, así un cambio
// (quitarle un permiso al rol, desactivar al usuario, cambiarle el rol) se nota enseguida,
// sin esperar a que cierre sesión.
//   res.locals.rolEsSistema -> true si su rol es el protegido (administrador): puede todo
//   res.locals.misPermisos  -> lista de claves, por ejemplo ['familiares:ver', 'internos:crear']
exports.cargarPermisos = async (req, res, next) => {
  res.locals.rolEsSistema = false;
  res.locals.misPermisos = [];

  try {
    const idUsuario = req.session && req.session.idUsuario;

    if (!idUsuario) {
      return next();   // nadie ha iniciado sesión
    }

    const actual = await usuarioModelo.buscarPorId(idUsuario);

    // El usuario ya no existe o lo desactivaron: se cierra su sesión
    if (!actual || actual.estado !== 1) {
      return req.session.destroy(() => res.redirect('/login'));
    }

    req.session.rol = actual.rol;   // por si le cambiaron el rol

    if (actual.es_sistema === 1) {
      res.locals.rolEsSistema = true;
    } else {
      res.locals.misPermisos = await rolModelo.clavesDePermisos(actual.id_rol);
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Protege una ruta: entra quien tenga AL MENOS UNO de los permisos indicados.
//   requierePermiso('familiares:ver')
//   requierePermiso('internos:crear', 'internos:editar')   <- cualquiera de los dos
exports.requierePermiso = (...claves) => (req, res, next) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }

  const permitido =
    res.locals.rolEsSistema ||
    claves.some((clave) => (res.locals.misPermisos || []).includes(clave));

  if (permitido) {
    return next();
  }

  res.status(403).render('sin-permiso', {
    titulo: 'Sin permiso',
    usuario: req.session.usuario,
    rol: req.session.rol
  });
};
