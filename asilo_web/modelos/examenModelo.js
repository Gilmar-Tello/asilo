const pool = require('../config/baseDatos');

// La orden de examen con los datos de su visita. SOLO las órdenes de visitas ya registradas
// (una visita en borrador todavía puede cambiar sus exámenes, así que el laboratorio no la ve).
const SELECT_BASE = `
  SELECT e.id_examen, e.id_visita, v.id_especialista, e.nombre_examen, e.costo_estimado, e.costo_real, e.estado,
         e.resultado, e.motivo_anulacion, e.id_examen_origen,
         DATE_FORMAT(e.fecha_resultado, '%d/%m/%Y %H:%i') AS fecha_resultado_texto,
         DATE_FORMAT(v.fecha_visita, '%d/%m/%Y %H:%i')    AS fecha_visita_texto,
         CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS interno_nombre,
         TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
         CONCAT_WS(' ', u.nombre1, u.apellido1) AS especialista_nombre,
         CONCAT_WS(' ', l.nombre1, l.apellido1) AS laboratorista_nombre
  FROM tbl_examenes_laboratorio e
  JOIN tbl_visitas_medicas v ON v.id_visita = e.id_visita AND v.estado = 'Registrada'
  JOIN tbl_internos i ON i.id_interno = v.id_interno
  JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
  LEFT JOIN tbl_usuarios l ON l.id_usuario = e.id_laboratorista
`;

// Lista las órdenes. Filtros: estado y búsqueda por nombre del interno o del examen.
async function listar({ estado, busqueda } = {}) {
  let sql = SELECT_BASE;
  const condiciones = [];
  const valores = [];

  if (estado) {
    condiciones.push(`e.estado = ?`);
    valores.push(estado);
  }

  if (busqueda) {
    condiciones.push(`(CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) LIKE ?
                       OR e.nombre_examen LIKE ?)`);
    const patron = `%${busqueda}%`;
    valores.push(patron, patron);
  }

  if (condiciones.length > 0) {
    sql += ` WHERE ` + condiciones.join(' AND ');
  }

  // Lo pendiente primero, lo más antiguo arriba (se atiende en orden de llegada)
  sql += ` ORDER BY (e.estado = 'Ordenado') DESC, v.fecha_visita, e.id_examen LIMIT 200`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

async function buscarPorId(id) {
  const [filas] = await pool.query(SELECT_BASE + ` WHERE e.id_examen = ?`, [id]);
  return filas[0];
}

// El laboratorista carga el resultado. Solo se puede si la orden sigue "Ordenado": un resultado
// ya cargado no se pisa (RN12); si hubo un error, se anula y se pide de nuevo.
// Devuelve cuántas filas cambió (0 = ya tenía resultado, estaba anulado o no existe).
//
// También guarda el PRECIO REAL del examen y, en la misma transacción, vuelve a sumar los exámenes
// de la visita (real si existe, aproximado si no) y la deja "Pendiente de cálculo" para que el
// microservicio de costos recalcule el total con el 20% de descuento.
async function registrarResultado(id, resultado, idLaboratorista, costoReal) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [r] = await conexion.query(
      `UPDATE tbl_examenes_laboratorio e
       JOIN tbl_visitas_medicas v ON v.id_visita = e.id_visita
          SET e.resultado = ?, e.costo_real = ?, e.estado = 'Con resultado',
              e.fecha_resultado = NOW(), e.id_laboratorista = ?
        WHERE e.id_examen = ? AND e.estado = 'Ordenado' AND v.estado = 'Registrada'`,
      [resultado, costoReal, idLaboratorista, id]
    );

    if (r.affectedRows === 0) {
      await conexion.rollback();
      return 0;
    }

    // Se suman TODAS las órdenes de la visita, también las anuladas: lo que se cobró una vez se
    // queda cobrado. La repetición de un examen anulado se guarda con precio real 0.
    const [[suma]] = await conexion.query(
      `SELECT COALESCE(SUM(COALESCE(e.costo_real, e.costo_estimado)), 0) AS total
         FROM tbl_examenes_laboratorio e
        WHERE e.id_visita = (SELECT id_visita FROM tbl_examenes_laboratorio WHERE id_examen = ?)`,
      [id]
    );

    await conexion.query(
      `UPDATE tbl_visitas_medicas v
          SET v.costo_examenes = ?,
              v.estado_costo = IF(v.costo_consulta + ? + v.costo_medicamentos > 0, 'Pendiente de cálculo', 'Sin cargos')
        WHERE v.id_visita = (SELECT id_visita FROM tbl_examenes_laboratorio WHERE id_examen = ?)`,
      [suma.total, suma.total, id]
    );

    await conexion.commit();
    return 1;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// FA-04 del CU-04: el resultado original se CONSERVA marcado "Anulado" y se crea una orden nueva.
// La orden nueva cuesta 0: el examen ya se cobró una vez (el total de la visita no cambia).
// Devuelve el id de la orden nueva, o null si el examen no se podía anular.
async function anular(id, motivo) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    // WHERE estado = 'Con resultado': solo se anula lo que ya tiene resultado, y una sola vez
    const [r] = await conexion.query(
      `UPDATE tbl_examenes_laboratorio SET estado = 'Anulado', motivo_anulacion = ?
        WHERE id_examen = ? AND estado = 'Con resultado'`,
      [motivo, id]
    );

    if (r.affectedRows === 0) {
      await conexion.rollback();
      return null;
    }

    const [nuevo] = await conexion.query(
      `INSERT INTO tbl_examenes_laboratorio (id_visita, nombre_examen, costo_estimado, id_examen_origen)
       SELECT id_visita, nombre_examen, 0, id_examen FROM tbl_examenes_laboratorio WHERE id_examen = ?`,
      [id]
    );

    await conexion.commit();
    return nuevo.insertId;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

module.exports = { listar, buscarPorId, registrarResultado, anular };
