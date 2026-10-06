const pool = require('../config/baseDatos');

// Lista los internos con el nombre de su familiar y su parentesco, con búsqueda opcional
async function listar(busqueda) {
  let sql = `
    SELECT i.id_interno,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS nombre_completo,
           i.dpi,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad,
           DATE_FORMAT(i.fecha_ingreso, '%d/%m/%Y') AS fecha_ingreso_texto,
           p.nombre AS parentesco, i.estado,
           f.nombre_completo AS familiar
    FROM tbl_internos i
    JOIN tbl_familiares_responsables f ON f.id_familiar = i.id_familiar
    JOIN tbl_parentescos p ON p.id_parentesco = i.id_parentesco
  `;

  const valores = [];

  if (busqueda) {
    sql += `
      WHERE CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) LIKE ?
         OR i.dpi LIKE ?
         OR f.nombre_completo LIKE ?
    `;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron, patron);
  }

  sql += ` ORDER BY i.apellido1, i.nombre1`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Busca un interno por su id. Los alias hacen que los nombres coincidan
// con los del formulario, y las fechas salen como texto AAAA-MM-DD
async function buscarPorId(id) {
  const sql = `
    SELECT id_interno,
           nombre1 AS primer_nombre, nombre2 AS segundo_nombre,
           apellido1 AS primer_apellido, apellido2 AS segundo_apellido,
           apellido_casada, sexo, dpi,
           DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
           DATE_FORMAT(fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
           estado_salud AS padecimientos,
           id_parentesco, id_familiar, estado
    FROM tbl_internos
    WHERE id_interno = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Registra un interno nuevo y devuelve el id generado
async function crear(datos) {
  const sql = `
    INSERT INTO tbl_internos
      (nombre1, nombre2, apellido1, apellido2, apellido_casada, sexo, dpi,
       fecha_nacimiento, fecha_ingreso, estado_salud, id_parentesco, id_familiar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [resultado] = await pool.query(sql, [
    datos.primer_nombre, datos.segundo_nombre,
    datos.primer_apellido, datos.segundo_apellido,
    datos.apellido_casada, datos.sexo, datos.dpi,
    datos.fecha_nacimiento, datos.fecha_ingreso,
    datos.padecimientos, datos.id_parentesco, datos.id_familiar
  ]);
  return resultado.insertId;
}

// Registra un interno nuevo CON sus padecimientos, todo en una transacción:
// o se guarda el interno y sus padecimientos, o no se guarda nada.
// padecimientos: lista de { nombre, medicamento, dosis }
async function crearConPadecimientos(datos, padecimientos) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [resultado] = await conexion.query(`
      INSERT INTO tbl_internos
        (nombre1, nombre2, apellido1, apellido2, apellido_casada, sexo, dpi,
         fecha_nacimiento, fecha_ingreso, estado_salud, id_parentesco, id_familiar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      datos.primer_nombre, datos.segundo_nombre,
      datos.primer_apellido, datos.segundo_apellido,
      datos.apellido_casada, datos.sexo, datos.dpi,
      datos.fecha_nacimiento, datos.fecha_ingreso,
      datos.padecimientos, datos.id_parentesco, datos.id_familiar
    ]);

    const idInterno = resultado.insertId;

    for (const p of padecimientos) {
      await conexion.query(`
        INSERT INTO tbl_psicopatologias
          (id_interno, nombre_padecimiento, medicamento_cajon, dosis, fecha_registro)
        VALUES (?, ?, ?, ?, CURDATE())
      `, [idInterno, p.nombre, p.medicamento || null, p.dosis || null]);
    }

    await conexion.commit();
    return idInterno;

  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Actualiza los datos de un interno (el estado se cambia aparte)
async function actualizar(id, datos) {
  const sql = `
    UPDATE tbl_internos
       SET nombre1 = ?, nombre2 = ?, apellido1 = ?, apellido2 = ?,
           apellido_casada = ?, sexo = ?, dpi = ?,
           fecha_nacimiento = ?, fecha_ingreso = ?,
           estado_salud = ?, id_parentesco = ?, id_familiar = ?
     WHERE id_interno = ?
  `;
  const [resultado] = await pool.query(sql, [
    datos.primer_nombre, datos.segundo_nombre,
    datos.primer_apellido, datos.segundo_apellido,
    datos.apellido_casada, datos.sexo, datos.dpi,
    datos.fecha_nacimiento, datos.fecha_ingreso,
    datos.padecimientos, datos.id_parentesco, datos.id_familiar,
    id
  ]);
  return resultado.affectedRows;
}

// Cambia el estado: 1 = activo, 2 = desactivado
async function cambiarEstado(id, nuevoEstado) {
  const sql = `UPDATE tbl_internos SET estado = ? WHERE id_interno = ?`;
  const [resultado] = await pool.query(sql, [nuevoEstado, id]);
  return resultado.affectedRows;
}

// Datos básicos de un interno (para la ficha de padecimientos y para las solicitudes)
async function buscarFicha(id) {
  const sql = `
    SELECT i.id_interno,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS nombre_completo,
           i.dpi, i.sexo,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad,
           i.estado
    FROM tbl_internos i
    WHERE i.id_interno = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Internos ACTIVOS por nombre o DPI (para el buscador del formulario de solicitudes).
// LIMIT 10: nunca se mandan miles de filas al navegador.
async function buscarActivos(texto) {
  const sql = `
    SELECT i.id_interno, i.dpi,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS nombre_completo
    FROM tbl_internos i
    WHERE i.estado = 1
      AND (CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) LIKE ?
           OR i.dpi LIKE ?)
    ORDER BY i.apellido1, i.nombre1
    LIMIT 10
  `;
  const patron = `%${texto}%`;
  const [filas] = await pool.query(sql, [patron, patron]);
  return filas;
}

module.exports = {
  listar, buscarPorId, buscarFicha, buscarActivos, crear, crearConPadecimientos, actualizar, cambiarEstado
};