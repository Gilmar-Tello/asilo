const pool = require('../config/baseDatos');

// Lista los familiares responsables, con búsqueda opcional
async function listar(busqueda) {
  let sql = `
    SELECT f.id_familiar, f.nombre_completo, f.dpi, f.telefono,
           f.correo_electronico, f.saldo_pendiente, f.estado,
           (SELECT COUNT(*) FROM tbl_internos i
             WHERE i.id_familiar = f.id_familiar AND i.estado = 1) AS internos_activos
    FROM tbl_familiares_responsables f
  `;

  const valores = [];

  if (busqueda) {
    sql += `
      WHERE f.nombre_completo LIKE ?
         OR f.dpi LIKE ?
         OR f.correo_electronico LIKE ?
    `;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron, patron);
  }

  sql += ` ORDER BY f.nombre_completo`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Busca un familiar por su id
async function buscarPorId(id) {
  const sql = `
    SELECT id_familiar, nombre_completo, dpi, telefono,
           correo_electronico, saldo_pendiente, estado
    FROM tbl_familiares_responsables
    WHERE id_familiar = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Cuántos internos ACTIVOS tiene a su cargo un familiar
async function contarInternosActivos(idFamiliar) {
  const sql = `
    SELECT COUNT(*) AS total
    FROM tbl_internos
    WHERE id_familiar = ? AND estado = 1
  `;
  const [filas] = await pool.query(sql, [idFamiliar]);
  return filas[0].total;
}

// Busca familiares ACTIVOS por nombre o DPI (para el buscador del formulario de internos).
// LIMIT 10: nunca se mandan miles de filas al navegador.
async function buscarActivos(texto) {
  const sql = `
    SELECT id_familiar, nombre_completo, dpi
    FROM tbl_familiares_responsables
    WHERE estado = 1
      AND (nombre_completo LIKE ? OR dpi LIKE ?)
    ORDER BY nombre_completo
    LIMIT 10
  `;
  const patron = `%${texto}%`;
  const [filas] = await pool.query(sql, [patron, patron]);
  return filas;
}

// Registra un familiar nuevo y devuelve el id generado
async function crear(datos) {
  const sql = `
    INSERT INTO tbl_familiares_responsables
      (nombre_completo, dpi, telefono, correo_electronico)
    VALUES (?, ?, ?, ?)
  `;
  const [resultado] = await pool.query(sql, [
    datos.nombre_completo, datos.dpi, datos.telefono, datos.correo_electronico
  ]);
  return resultado.insertId;
}

// Actualiza los datos personales (el saldo y el estado NO se cambian desde aquí)
async function actualizar(id, datos) {
  const sql = `
    UPDATE tbl_familiares_responsables
       SET nombre_completo = ?, dpi = ?, telefono = ?, correo_electronico = ?
     WHERE id_familiar = ?
  `;
  const [resultado] = await pool.query(sql, [
    datos.nombre_completo, datos.dpi, datos.telefono, datos.correo_electronico, id
  ]);
  return resultado.affectedRows;
}

// Cambia el estado: 1 = activo, 2 = desactivado
async function cambiarEstado(id, nuevoEstado) {
  const sql = `UPDATE tbl_familiares_responsables SET estado = ? WHERE id_familiar = ?`;
  const [resultado] = await pool.query(sql, [nuevoEstado, id]);
  return resultado.affectedRows;
}

module.exports = {
  listar, buscarPorId, contarInternosActivos, buscarActivos,
  crear, actualizar, cambiarEstado
};