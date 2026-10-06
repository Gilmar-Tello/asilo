const pool = require('../config/baseDatos');

// Busca un usuario del personal de la Fundación por su nombre de usuario (para el login)
async function buscarPorUsuario(usuario) {
  const sql = `
    SELECT id_usuario, nombre, usuario, contrasenia, estado
    FROM tbl_usuarios
    WHERE usuario = ?
  `;
  const [filas] = await pool.query(sql, [usuario]);
  return filas[0];
}

module.exports = { buscarPorUsuario };
