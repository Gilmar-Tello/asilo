const pool = require('../config/baseDatos');

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;

const SELECT_CONSULTA = `
  SELECT c.id_consulta, c.id_interno, c.id_medico, c.motivo, c.temperatura, c.presion, c.pulso, c.saturacion,
         c.hallazgos, c.diagnostico, c.indicaciones, c.anulada, c.motivo_anulacion,
         DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_texto,
         ${NOMBRE_INTERNO} AS interno_nombre, i.dpi AS interno_dpi,
         TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
         CONCAT_WS(' ', m.nombre1, m.apellido1) AS medico_nombre,
         (SELECT s.id_solicitud FROM tbl_solicitudes_referencia s
           WHERE s.id_consulta = c.id_consulta ORDER BY s.id_solicitud DESC LIMIT 1) AS id_solicitud
  FROM tbl_consultas_generales c
  JOIN tbl_internos i ON i.id_interno = c.id_interno
  JOIN tbl_usuarios m ON m.id_usuario = c.id_medico
`;

// Todas las consultas (las más recientes primero). Búsqueda por interno o diagnóstico.
async function listar(busqueda) {
  let sql = SELECT_CONSULTA;
  const valores = [];

  if (busqueda) {
    sql += ` WHERE ${NOMBRE_INTERNO} LIKE ? OR i.dpi LIKE ? OR c.diagnostico LIKE ? OR c.motivo LIKE ?`;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron, patron, patron);
  }

  sql += ` ORDER BY c.fecha DESC, c.id_consulta DESC LIMIT 200`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Las últimas consultas de un interno (para su historial)
async function deInterno(idInterno, limite = 10) {
  const [filas] = await pool.query(
    SELECT_CONSULTA + ` WHERE c.id_interno = ? ORDER BY c.fecha DESC, c.id_consulta DESC LIMIT ?`,
    [idInterno, limite]
  );
  return filas;
}

async function buscarPorId(id) {
  const [filas] = await pool.query(SELECT_CONSULTA + ` WHERE c.id_consulta = ?`, [id]);
  return filas[0];
}

// Las recetas de una consulta, con el medicamento del catálogo
async function recetas(idConsulta) {
  const [filas] = await pool.query(
    `SELECT rc.id_receta_consulta, rc.cantidad, rc.indicaciones, rc.cantidad_despachada, rc.sin_existencia,
            m.nombre, m.presentacion
       FROM tbl_recetas_consulta rc
       JOIN tbl_medicamentos m ON m.id_medicamento = rc.id_medicamento
      WHERE rc.id_consulta = ?
      ORDER BY rc.id_receta_consulta`,
    [idConsulta]
  );
  return filas;
}

// Guarda la consulta con sus recetas (todo o nada). recetas: [{ id_medicamento, cantidad, indicaciones }]
async function crear(datos, listaRecetas) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [r] = await conexion.query(
      `INSERT INTO tbl_consultas_generales
         (id_interno, id_medico, motivo, temperatura, presion, pulso, saturacion, hallazgos, diagnostico, indicaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.id_interno, datos.id_medico, datos.motivo, datos.temperatura, datos.presion, datos.pulso,
       datos.saturacion, datos.hallazgos, datos.diagnostico, datos.indicaciones]
    );

    for (const receta of listaRecetas) {
      // El medicamento tiene que estar activo en el catálogo en este momento
      const [[med]] = await conexion.query(
        `SELECT id_medicamento FROM tbl_medicamentos WHERE id_medicamento = ? AND estado = 1`,
        [receta.id_medicamento]
      );
      if (!med) {
        const error = new Error('Uno de los medicamentos elegidos ya no está activo en el catálogo.');
        error.deNegocio = true;
        throw error;
      }

      await conexion.query(
        `INSERT INTO tbl_recetas_consulta (id_consulta, id_medicamento, cantidad, indicaciones) VALUES (?, ?, ?, ?)`,
        [r.insertId, receta.id_medicamento, receta.cantidad, receta.indicaciones]
      );
    }

    await conexion.commit();
    return r.insertId;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// RN12: no se borra; se anula con su motivo. Lo que aún no se despachó deja de aparecer en farmacia.
async function anular(id, motivo) {
  const [r] = await pool.query(
    `UPDATE tbl_consultas_generales SET anulada = 1, motivo_anulacion = ? WHERE id_consulta = ? AND anulada = 0`,
    [motivo, id]
  );
  return r.affectedRows;
}

module.exports = { listar, deInterno, buscarPorId, recetas, crear, anular };
