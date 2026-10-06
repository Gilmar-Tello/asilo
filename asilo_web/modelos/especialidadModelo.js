const pool = require('../config/baseDatos');

// Lista todas las especialidades con cuántos usuarios (médicos) la tienen
async function listar() {
  const sql = `
    SELECT e.id_especialidad, e.nombre, e.estado,
           (SELECT COUNT(*) FROM tbl_usuarios u
             WHERE u.id_especialidad = e.id_especialidad) AS total_usuarios
    FROM tbl_especialidades e
    ORDER BY e.nombre
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

// Busca una especialidad por su id (incluye cuántos usuarios la tienen)
async function buscarPorId(id) {
  const sql = `
    SELECT e.id_especialidad, e.nombre, e.estado,
           (SELECT COUNT(*) FROM tbl_usuarios u
             WHERE u.id_especialidad = e.id_especialidad) AS total_usuarios
    FROM tbl_especialidades e
    WHERE e.id_especialidad = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Especialidades que se pueden elegir en el formulario de usuarios: las activas,
// más la que el usuario ya tiene (aunque esté desactivada), para que al editar no desaparezca
async function listarParaSeleccion(idActual) {
  const sql = `
    SELECT id_especialidad, nombre
    FROM tbl_especialidades
    WHERE estado = 1 OR id_especialidad = ?
    ORDER BY nombre
  `;
  const [filas] = await pool.query(sql, [idActual || 0]);
  return filas;
}

async function crear(nombre) {
  const sql = `INSERT INTO tbl_especialidades (nombre) VALUES (?)`;
  const [resultado] = await pool.query(sql, [nombre]);
  return resultado.insertId;
}

// Cambiar el nombre llega solo a los médicos (guardan el id) y, en la siguiente
// sincronización, a la Fundación
async function actualizar(id, nombre) {
  const sql = `UPDATE tbl_especialidades SET nombre = ? WHERE id_especialidad = ?`;
  const [resultado] = await pool.query(sql, [nombre, id]);
  return resultado.affectedRows;
}

// Cambia el estado: 1 = activa, 2 = desactivada
async function cambiarEstado(id, nuevoEstado) {
  const sql = `UPDATE tbl_especialidades SET estado = ? WHERE id_especialidad = ?`;
  const [resultado] = await pool.query(sql, [nuevoEstado, id]);
  return resultado.affectedRows;
}

// Elimina una especialidad (solo funciona si ningún usuario la usa)
async function eliminar(id) {
  const sql = `DELETE FROM tbl_especialidades WHERE id_especialidad = ?`;
  const [resultado] = await pool.query(sql, [id]);
  return resultado.affectedRows;
}

module.exports = {
  listar, buscarPorId, listarParaSeleccion, crear, actualizar, cambiarEstado, eliminar
};
