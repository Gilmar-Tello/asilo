// Que el personal de la Fundación haya iniciado sesión
exports.requiereLogin = (req, res, next) => {
  if (!req.session.idUsuario) {
    return res.redirect('/login');
  }
  next();
};
