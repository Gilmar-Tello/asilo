const pool = require('../config/baseDatos');

// Todos los padecimientos de un interno (los anulados al final y tachados en la vista)
async function listarPorInterno(idInterno) {
  const sql = `
    SELECT id_psicopatologia, nombre_padecimiento, descripcion, medicamento_cajon, dosis,
           DATE_FORMAT(fecha_registro, '%d/%m/%Y') AS fecha_texto, anulada
    FROM tbl_psicopatologias
    WHERE id_interno = ?
    ORDER BY anulada, fecha_registro DESC, id_psicopatologia DESC
  `;
  const [filas] = await pool.query(sql, [idInterno]);
  return filas;
}

// Solo los vigentes (los que cuentan para una solicitud y se envían a la Fundación)
async function listarActivas(idInterno) {
  const sql = `
    SELECT nombre_padecimiento, descripcion, medicamento_cajon, dosis
    FROM tbl_psicopatologias
    WHERE id_interno = ? AND anulada = 0
    ORDER BY fecha_registro DESC, id_psicopatologia DESC
  `;
  const [filas] = await pool.query(sql, [idInterno]);
  return filas;
}

// Cuántos padecimientos vigentes tiene un interno
async function contarActivas(idInterno) {
  const sql = `SELECT COUNT(*) AS total FROM tbl_psicopatologias WHERE id_interno = ? AND anulada = 0`;
  const [filas] = await pool.query(sql, [idInterno]);
  return filas[0].total;
}

async function buscarPorId(id) {
  const sql = `
    SELECT id_psicopatologia, id_interno, anulada
    FROM tbl_psicopatologias
    WHERE id_psicopatologia = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Registra un padecimiento. La fecha de registro la pone la base (hoy): no se escribe a mano.
async function crear(datos) {
  const sql = `
    INSERT INTO tbl_psicopatologias
      (id_interno, nombre_padecimiento, descripcion, medicamento_cajon, dosis, fecha_registro)
    VALUES (?, ?, ?, ?, ?, CURDATE())
  `;
  const [resultado] = await pool.query(sql, [
    datos.id_interno, datos.nombre_padecimiento, datos.descripcion,
    datos.medicamento_cajon, datos.dosis
  ]);
  return resultado.insertId;
}

// Un registro clínico nunca se borra (RN12): se anula y se conserva en el historial
async function anular(id) {
  const sql = `UPDATE tbl_psicopatologias SET anulada = 1 WHERE id_psicopatologia = ?`;
  const [resultado] = await pool.query(sql, [id]);
  return resultado.affectedRows;
}

// Internos con cuántos padecimientos vigentes tienen (para la pantalla "Padecimientos" del médico).
// Con búsqueda por nombre o DPI; máximo 100 filas.
async function listarInternos(busqueda) {
  let sql = `
    SELECT i.id_interno, i.dpi, i.estado,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS nombre_completo,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad,
           (SELECT COUNT(*) FROM tbl_psicopatologias p
             WHERE p.id_interno = i.id_interno AND p.anulada = 0) AS total_padecimientos
    FROM tbl_internos i
  `;

  const valores = [];

  if (busqueda) {
    sql += `
      WHERE CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) LIKE ?
         OR i.dpi LIKE ?
    `;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron);
  }

  sql += ` ORDER BY i.apellido1, i.nombre1 LIMIT 100`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

module.exports = { listarPorInterno, listarActivas, contarActivas, buscarPorId, crear, anular, listarInternos };
