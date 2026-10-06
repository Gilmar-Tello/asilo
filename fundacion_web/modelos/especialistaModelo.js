const pool = require('../config/baseDatos');

// Nombres de las especialidades activas (es lo que el asilo muestra en su formulario)
async function listarEspecialidadesActivas() {
  const sql = `SELECT nombre FROM tbl_especialidades WHERE estado = 1 ORDER BY nombre`;
  const [filas] = await pool.query(sql);
  return filas.map((fila) => fila.nombre);
}

// Especialistas activos de una especialidad
async function listarActivosPorEspecialidad(nombreEspecialidad) {
  const sql = `
    SELECT s.id_especialista, s.nombre_completo
    FROM tbl_especialistas s
    JOIN tbl_especialidades e ON e.id_especialidad = s.id_especialidad
    WHERE s.estado = 1 AND e.estado = 1 AND e.nombre = ?
    ORDER BY s.nombre_completo
  `;
  const [filas] = await pool.query(sql, [nombreEspecialidad]);
  return filas;
}

// Un especialista activo, con el nombre de su especialidad.
// Si se indica nombreEspecialidad, también comprueba que sea de esa especialidad. La comparación la hace
// la base de datos (igual que la lista de especialistas), que ignora mayúsculas y tildes:
// "Cardiología" y "CARDIOLOGIA" son la misma especialidad.
async function buscarActivoPorId(id, nombreEspecialidad) {
  let sql = `
    SELECT s.id_especialista, s.nombre_completo, e.nombre AS especialidad
    FROM tbl_especialistas s
    JOIN tbl_especialidades e ON e.id_especialidad = s.id_especialidad
    WHERE s.id_especialista = ? AND s.estado = 1 AND e.estado = 1
  `;
  const valores = [id];

  if (nombreEspecialidad) {
    sql += ` AND e.nombre = ?`;
    valores.push(nombreEspecialidad);
  }

  const [filas] = await pool.query(sql, valores);
  return filas[0];
}

// ¿El especialista ya tiene otra cita a menos de 1 hora de esa fecha? (FE-01 del CU-03)
// idReferencia se excluye, para poder reprogramar la misma cita sin chocar consigo misma.
async function tieneCitaCerca(idEspecialista, fechaSql, idReferencia) {
  const sql = `
    SELECT COUNT(*) AS total
    FROM tbl_referencias
    WHERE id_especialista = ?
      AND id_referencia <> ?
      AND estado IN ('Programada', 'Reprogramada')
      AND fecha_cita IS NOT NULL
      AND ABS(TIMESTAMPDIFF(MINUTE, fecha_cita, ?)) < 60
  `;
  const [filas] = await pool.query(sql, [idEspecialista, idReferencia, fechaSql]);
  return filas[0].total > 0;
}

// Sincroniza los especialistas con la lista COMPLETA que manda el asilo (el asilo es quien los registra).
//   lista: [{ id_externo, nombre_completo, especialidad }]
// - Cada especialista se identifica por su id en el asilo (id_externo): se crea o se actualiza.
// - Quien ya no viene en la lista se desactiva (incluye a los de ejemplo que no son del asilo).
// - Las especialidades se crean según lo que mande el asilo, y quedan activas solo si
//   tienen al menos un especialista activo.
// Todo en una transacción: o se aplica completo, o no se toca nada.
async function sincronizar(lista) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const idsExternos = [];

    for (const especialista of lista) {
      // La especialidad se busca por nombre (la comparación ignora mayúsculas y tildes)
      const [existentes] = await conexion.query(
        'SELECT id_especialidad, nombre FROM tbl_especialidades WHERE nombre = ?',
        [especialista.especialidad]
      );

      let idEspecialidad;

      if (existentes.length > 0) {
        idEspecialidad = existentes[0].id_especialidad;

        // El asilo manda: si la escribió distinto (otra tilde o mayúsculas), se adopta su forma
        if (existentes[0].nombre !== especialista.especialidad) {
          await conexion.query(
            'UPDATE tbl_especialidades SET nombre = ? WHERE id_especialidad = ?',
            [especialista.especialidad, idEspecialidad]
          );
        }
      } else {
        const [creada] = await conexion.query(
          'INSERT INTO tbl_especialidades (nombre) VALUES (?)',
          [especialista.especialidad]
        );
        idEspecialidad = creada.insertId;
      }

      await conexion.query(`
        INSERT INTO tbl_especialistas (id_externo, nombre_completo, id_especialidad, estado)
        VALUES (?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          nombre_completo = VALUES(nombre_completo),
          id_especialidad = VALUES(id_especialidad),
          estado = 1
      `, [especialista.id_externo, especialista.nombre_completo, idEspecialidad]);

      idsExternos.push(especialista.id_externo);
    }

    if (idsExternos.length > 0) {
      await conexion.query(
        'UPDATE tbl_especialistas SET estado = 2 WHERE id_externo IS NULL OR id_externo NOT IN (?)',
        [idsExternos]
      );
    } else {
      await conexion.query('UPDATE tbl_especialistas SET estado = 2');
    }

    await conexion.query(`
      UPDATE tbl_especialidades e
         SET e.estado = IF(EXISTS (
               SELECT 1 FROM tbl_especialistas s
                WHERE s.id_especialidad = e.id_especialidad AND s.estado = 1
             ), 1, 2)
    `);

    await conexion.commit();

    return { recibidos: lista.length };
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

module.exports = {
  listarEspecialidadesActivas, listarActivosPorEspecialidad,
  buscarActivoPorId, tieneCitaCerca, sincronizar
};
