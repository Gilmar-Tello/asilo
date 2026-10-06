const pool = require('../config/baseDatos');

// Lista todos los parentescos con cuántos internos lo usan
async function listar() {
  const sql = `
    SELECT p.id_parentesco, p.nombre, p.estado,
           (SELECT COUNT(*) FROM tbl_internos i
             WHERE i.id_parentesco = p.id_parentesco) AS total_internos
    FROM tbl_parentescos p
    ORDER BY p.nombre
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

// Busca un parentesco por su id (incluye cuántos internos lo usan)
async function buscarPorId(id) {
  const sql = `
    SELECT p.id_parentesco, p.nombre, p.estado,
           (SELECT COUNT(*) FROM tbl_internos i
             WHERE i.id_parentesco = p.id_parentesco) AS total_internos
    FROM tbl_parentescos p
    WHERE p.id_parentesco = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Parentescos que se pueden elegir en el formulario de internos:
// los activos, más el que el interno ya tiene (aunque esté desactivado)
async function listarParaSeleccion(idActual) {
  const sql = `
    SELECT id_parentesco, nombre
    FROM tbl_parentescos
    WHERE estado = 1 OR id_parentesco = ?
    ORDER BY nombre
  `;
  const [filas] = await pool.query(sql, [idActual || 0]);
  return filas;
}

// Crea un parentesco y devuelve su id
async function crear(nombre) {
  const sql = `INSERT INTO tbl_parentescos (nombre) VALUES (?)`;
  const [resultado] = await pool.query(sql, [nombre]);
  return resultado.insertId;
}

// Cambia el nombre (los internos lo reflejan solos, porque guardan el id)
async function actualizar(id, nombre) {
  const sql = `UPDATE tbl_parentescos SET nombre = ? WHERE id_parentesco = ?`;
  const [resultado] = await pool.query(sql, [nombre, id]);
  return resultado.affectedRows;
}

// Cambia el estado: 1 = activo, 2 = desactivado
async function cambiarEstado(id, nuevoEstado) {
  const sql = `UPDATE tbl_parentescos SET estado = ? WHERE id_parentesco = ?`;
  const [resultado] = await pool.query(sql, [nuevoEstado, id]);
  return resultado.affectedRows;
}

// Elimina un parentesco (solo funciona si ningún interno lo usa)
async function eliminar(id) {
  const sql = `DELETE FROM tbl_parentescos WHERE id_parentesco = ?`;
  const [resultado] = await pool.query(sql, [id]);
  return resultado.affectedRows;
}

module.exports = {
  listar, buscarPorId, listarParaSeleccion,
  crear, actualizar, cambiarEstado, eliminar
};