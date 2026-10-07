const pool = require('../config/baseDatos');

// Lote "vigente" = no vencido (o sin fecha, solo el saldo anterior a los lotes). Es lo único que se despacha.
const LOTE_VIGENTE = `(l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURDATE())`;

// Catálogo con el resumen de sus lotes:
//   existencia  = todo lo que hay físicamente (incluye vencido)
//   disponible  = lo que se puede despachar (no vencido)
//   vencida     = unidades vencidas que hay que dar de baja
//   proximo_vencimiento = la fecha más cercana de lo disponible
async function listar(busqueda) {
  let sql = `
    SELECT m.id_medicamento, m.nombre, m.presentacion, m.precio, m.existencia, m.existencia_minima, m.estado,
           COALESCE(SUM(CASE WHEN ${LOTE_VIGENTE} THEN l.existencia END), 0)     AS disponible,
           COALESCE(SUM(CASE WHEN NOT ${LOTE_VIGENTE} THEN l.existencia END), 0) AS vencida,
           DATE_FORMAT(MIN(CASE WHEN l.existencia > 0 AND l.fecha_vencimiento >= CURDATE() THEN l.fecha_vencimiento END), '%d/%m/%Y') AS proximo_vencimiento,
           DATEDIFF(MIN(CASE WHEN l.existencia > 0 AND l.fecha_vencimiento >= CURDATE() THEN l.fecha_vencimiento END), CURDATE()) AS dias_para_vencer
    FROM tbl_medicamentos m
    LEFT JOIN tbl_lotes_medicamento l ON l.id_medicamento = m.id_medicamento AND l.existencia > 0
  `;
  const valores = [];

  if (busqueda) {
    sql += ` WHERE m.nombre LIKE ? OR m.presentacion LIKE ?`;
    valores.push(`%${busqueda}%`, `%${busqueda}%`);
  }

  sql += ` GROUP BY m.id_medicamento ORDER BY m.estado, m.nombre, m.presentacion LIMIT 300`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Los activos con lo DISPONIBLE (no vencido) como existencia: para el POS y para sugerir al especialista
async function listarActivos() {
  const [filas] = await pool.query(
    `SELECT m.id_medicamento, m.nombre, m.presentacion, m.precio,
            CAST(COALESCE(SUM(CASE WHEN ${LOTE_VIGENTE} THEN l.existencia END), 0) AS SIGNED) AS existencia
       FROM tbl_medicamentos m
       LEFT JOIN tbl_lotes_medicamento l ON l.id_medicamento = m.id_medicamento AND l.existencia > 0
      WHERE m.estado = 1
      GROUP BY m.id_medicamento
      ORDER BY m.nombre, m.presentacion`
  );
  return filas;
}

async function buscarPorId(id) {
  const [filas] = await pool.query(
    `SELECT id_medicamento, nombre, presentacion, precio, existencia, existencia_minima, estado
       FROM tbl_medicamentos WHERE id_medicamento = ?`,
    [id]
  );
  return filas[0];
}

// Guarda un lote nuevo, suma su cantidad a la existencia y anota el movimiento de entrada
async function insertarLote(conexion, idMedicamento, lote, idUsuario) {
  const [r] = await conexion.query(
    `INSERT INTO tbl_lotes_medicamento
       (id_medicamento, numero_lote, fecha_vencimiento, precio_compra, proveedor, cantidad_inicial, existencia, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [idMedicamento, lote.numero_lote, lote.fecha_vencimiento, lote.precio_compra, lote.proveedor,
     lote.cantidad, lote.cantidad, idUsuario]
  );

  await conexion.query(
    `UPDATE tbl_medicamentos SET existencia = existencia + ? WHERE id_medicamento = ?`,
    [lote.cantidad, idMedicamento]
  );

  await conexion.query(
    `INSERT INTO tbl_movimientos_medicamento (id_medicamento, id_lote, tipo, cantidad, id_usuario)
     VALUES (?, ?, 'Ingreso', ?, ?)`,
    [idMedicamento, r.insertId, lote.cantidad, idUsuario]
  );
}

// Crea el medicamento y, si viene, su primer lote (todo o nada)
async function crear(datos, lote, idUsuario) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [r] = await conexion.query(
      `INSERT INTO tbl_medicamentos (nombre, presentacion, precio, existencia, existencia_minima) VALUES (?, ?, ?, 0, ?)`,
      [datos.nombre, datos.presentacion, datos.precio, datos.existencia_minima]
    );

    if (lote) {
      await insertarLote(conexion, r.insertId, lote, idUsuario);
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

// Editar NO toca la existencia: la existencia solo cambia con lotes, despachos y bajas
async function editar(id, datos) {
  await pool.query(
    `UPDATE tbl_medicamentos SET nombre = ?, presentacion = ?, precio = ?, existencia_minima = ? WHERE id_medicamento = ?`,
    [datos.nombre, datos.presentacion, datos.precio, datos.existencia_minima, id]
  );
}

async function cambiarEstado(id, estado) {
  await pool.query(`UPDATE tbl_medicamentos SET estado = ? WHERE id_medicamento = ?`, [estado, id]);
}

// Entrada de un lote nuevo (compra, donación...). Devuelve false si el medicamento no está activo.
async function ingresar(id, lote, idUsuario) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [[med]] = await conexion.query(
      `SELECT estado FROM tbl_medicamentos WHERE id_medicamento = ? FOR UPDATE`,
      [id]
    );

    if (!med || med.estado !== 1) {
      await conexion.rollback();
      return false;
    }

    await insertarLote(conexion, id, lote, idUsuario);

    await conexion.commit();
    return true;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Lotes de un medicamento con su situación (los que aún tienen existencia primero)
async function lotes(id) {
  const [filas] = await pool.query(
    `SELECT l.id_lote, l.numero_lote, l.precio_compra, l.proveedor, l.cantidad_inicial, l.existencia,
            DATE_FORMAT(l.fecha_vencimiento, '%d/%m/%Y') AS vencimiento_texto,
            DATE_FORMAT(l.fecha_ingreso, '%d/%m/%Y')     AS ingreso_texto,
            DATEDIFF(l.fecha_vencimiento, CURDATE())     AS dias_para_vencer,
            (l.fecha_vencimiento < CURDATE())            AS vencido
       FROM tbl_lotes_medicamento l
      WHERE l.id_medicamento = ?
      ORDER BY (l.existencia = 0), l.fecha_vencimiento IS NULL, l.fecha_vencimiento, l.id_lote
      LIMIT 100`,
    [id]
  );
  return filas;
}

// Da de baja lo que queda de un lote VENCIDO (no se puede despachar). Queda como movimiento "Baja".
// Devuelve el id del medicamento, o null si el lote no está vencido o ya no tiene existencia.
async function darDeBaja(idLote, idUsuario) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [[lote]] = await conexion.query(
      `SELECT id_lote, id_medicamento, existencia FROM tbl_lotes_medicamento
        WHERE id_lote = ? AND existencia > 0 AND fecha_vencimiento < CURDATE()
        FOR UPDATE`,
      [idLote]
    );

    if (!lote) {
      await conexion.rollback();
      return null;
    }

    await conexion.query(`UPDATE tbl_lotes_medicamento SET existencia = 0 WHERE id_lote = ?`, [idLote]);
    await conexion.query(
      `UPDATE tbl_medicamentos SET existencia = existencia - ? WHERE id_medicamento = ?`,
      [lote.existencia, lote.id_medicamento]
    );
    await conexion.query(
      `INSERT INTO tbl_movimientos_medicamento (id_medicamento, id_lote, tipo, cantidad, id_usuario)
       VALUES (?, ?, 'Baja', ?, ?)`,
      [lote.id_medicamento, idLote, lote.existencia, idUsuario]
    );

    await conexion.commit();
    return lote.id_medicamento;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Últimos movimientos de un medicamento (entradas, despachos y bajas)
async function movimientos(id) {
  const [filas] = await pool.query(
    `SELECT m.tipo, m.cantidad, m.id_despacho, l.numero_lote,
            DATE_FORMAT(m.fecha, '%d/%m/%Y %H:%i') AS fecha_texto,
            CONCAT_WS(' ', u.nombre1, u.apellido1) AS usuario_nombre
       FROM tbl_movimientos_medicamento m
       JOIN tbl_usuarios u ON u.id_usuario = m.id_usuario
       LEFT JOIN tbl_lotes_medicamento l ON l.id_lote = m.id_lote
      WHERE m.id_medicamento = ?
      ORDER BY m.fecha DESC, m.id_movimiento DESC
      LIMIT 50`,
    [id]
  );
  return filas;
}

module.exports = {
  listar, listarActivos, buscarPorId, crear, editar, cambiarEstado,
  ingresar, lotes, darDeBaja, movimientos
};
