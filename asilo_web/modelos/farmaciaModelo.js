const pool = require('../config/baseDatos');

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;

// Error de una regla del negocio (sin existencia, más de lo recetado...): el mensaje se le muestra al usuario
class ErrorDespacho extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.deNegocio = true;
  }
}

// La "cola" del POS: internos con recetas pendientes de despacho.
// Con búsqueda, cualquier interno activo (para despachar su medicamento de cajón aunque no tenga recetas).
async function cola(busqueda) {
  let sql = `
    SELECT i.id_interno, i.dpi, ${NOMBRE_INTERNO} AS nombre_completo,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad,
           (SELECT COUNT(*) FROM tbl_recetas_visita r
              JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita AND v.estado = 'Registrada'
             WHERE v.id_interno = i.id_interno AND r.cantidad_despachada < r.cantidad) AS recetas_pendientes,
           (SELECT COUNT(*) FROM tbl_psicopatologias p
             WHERE p.id_interno = i.id_interno AND p.anulada = 0
               AND p.medicamento_cajon IS NOT NULL AND p.medicamento_cajon <> '') AS medicamentos_cajon
    FROM tbl_internos i
    WHERE i.estado = 1
  `;
  const valores = [];

  if (busqueda) {
    sql += ` AND (${NOMBRE_INTERNO} LIKE ? OR i.dpi LIKE ?)`;
    valores.push(`%${busqueda}%`, `%${busqueda}%`);
  } else {
    sql += ` HAVING recetas_pendientes > 0`;
  }

  sql += ` ORDER BY recetas_pendientes DESC, i.apellido1, i.nombre1 LIMIT 100`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

async function buscarInterno(id) {
  const [filas] = await pool.query(
    `SELECT i.id_interno, i.dpi, i.estado, ${NOMBRE_INTERNO} AS nombre_completo,
            TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad
       FROM tbl_internos i WHERE i.id_interno = ?`,
    [id]
  );
  return filas[0];
}

// Recetas de visitas registradas que todavía tienen algo por despachar
async function recetasPendientes(idInterno) {
  const [filas] = await pool.query(
    `SELECT r.id_receta, r.id_visita, r.medicamento, r.area_aplicacion, r.cantidad, r.tiempo_aplicacion,
            r.cantidad_despachada, r.cantidad - r.cantidad_despachada AS pendiente, r.sin_existencia,
            DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha_visita_texto,
            CONCAT_WS(' ', u.nombre1, u.apellido1) AS especialista_nombre
       FROM tbl_recetas_visita r
       JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita AND v.estado = 'Registrada'
       JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
      WHERE v.id_interno = ? AND r.cantidad_despachada < r.cantidad
      ORDER BY v.fecha_visita, r.id_receta`,
    [idInterno]
  );
  return filas;
}

// Recetas ya despachadas completas, con la fecha y quién despachó la última vez (FE-01)
async function recetasDespachadas(idInterno) {
  const [filas] = await pool.query(
    `SELECT r.id_receta, r.medicamento, r.cantidad,
            DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha_visita_texto,
            (SELECT DATE_FORMAT(d.fecha, '%d/%m/%Y %H:%i')
               FROM tbl_medicamentos_despachados dd JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
              WHERE dd.id_receta = r.id_receta ORDER BY d.fecha DESC LIMIT 1) AS ultimo_despacho_texto,
            (SELECT CONCAT_WS(' ', f.nombre1, f.apellido1)
               FROM tbl_medicamentos_despachados dd JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
               JOIN tbl_usuarios f ON f.id_usuario = d.id_farmaceutico
              WHERE dd.id_receta = r.id_receta ORDER BY d.fecha DESC LIMIT 1) AS despachado_por
       FROM tbl_recetas_visita r
       JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita AND v.estado = 'Registrada'
      WHERE v.id_interno = ? AND r.cantidad_despachada >= r.cantidad
      ORDER BY v.fecha_visita DESC, r.id_receta DESC
      LIMIT 20`,
    [idInterno]
  );
  return filas;
}

// Medicamentos de cajón vigentes del interno (indicación permanente, RN16)
async function medicamentosCajon(idInterno) {
  const [filas] = await pool.query(
    `SELECT id_psicopatologia, nombre_padecimiento, medicamento_cajon, dosis
       FROM tbl_psicopatologias
      WHERE id_interno = ? AND anulada = 0 AND medicamento_cajon IS NOT NULL AND medicamento_cajon <> ''
      ORDER BY nombre_padecimiento`,
    [idInterno]
  );
  return filas;
}

// Arma el mensaje cuando una receta no admite la cantidad pedida (RN11 y FE-01)
async function explicarReceta(conexion, idReceta) {
  const [[r]] = await conexion.query(
    `SELECT r.medicamento, r.cantidad, r.cantidad_despachada,
            (SELECT DATE_FORMAT(d.fecha, '%d/%m/%Y %H:%i') FROM tbl_medicamentos_despachados dd
               JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
              WHERE dd.id_receta = r.id_receta ORDER BY d.fecha DESC LIMIT 1) AS fecha,
            (SELECT CONCAT_WS(' ', f.nombre1, f.apellido1) FROM tbl_medicamentos_despachados dd
               JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
               JOIN tbl_usuarios f ON f.id_usuario = d.id_farmaceutico
              WHERE dd.id_receta = r.id_receta ORDER BY d.fecha DESC LIMIT 1) AS quien
       FROM tbl_recetas_visita r WHERE r.id_receta = ?`,
    [idReceta]
  );

  if (!r) return 'Una de las recetas ya no existe.';

  const pendiente = r.cantidad - r.cantidad_despachada;

  if (pendiente <= 0) {
    return `La receta de ${r.medicamento} ya fue despachada${r.fecha ? ` el ${r.fecha}` : ''}${r.quien ? ` por ${r.quien}` : ''}.`;
  }
  return `De ${r.medicamento} solo quedan ${pendiente} por despachar: no se puede entregar más de lo recetado.`;
}

// EL DESPACHO, en una sola transacción (o se guarda todo o nada):
//   - baja la existencia (nunca por debajo de 0)
//   - suma lo despachado a la receta (nunca más de lo recetado, RN11)
//   - anota el detalle y el movimiento de inventario
//   - las recetas despachadas suman su costo a la visita y la dejan "Pendiente de cálculo" (RN9)
//   - marca las recetas "sin existencia" (FA-02)
// lineas: [{ tipo: 'receta'|'cajon', id_origen, id_medicamento, cantidad }]
// Devuelve { idDespacho (o null si solo se marcó sin existencia), visitas: [ids afectados] }
async function despachar({ idInterno, idFarmaceutico, lineas, sinExistencia }) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    let idDespacho = null;
    const visitas = new Set();

    if (lineas.length > 0) {
      const [d] = await conexion.query(
        `INSERT INTO tbl_despachos (id_interno, id_farmaceutico) VALUES (?, ?)`,
        [idInterno, idFarmaceutico]
      );
      idDespacho = d.insertId;
    }

    for (const linea of lineas) {
      // El precio sale del catálogo (nunca del formulario: se podría manipular)
      const [[med]] = await conexion.query(
        `SELECT id_medicamento, nombre, presentacion, precio, existencia, estado
           FROM tbl_medicamentos WHERE id_medicamento = ? FOR UPDATE`,
        [linea.id_medicamento]
      );

      if (!med || med.estado !== 1) {
        throw new ErrorDespacho('Uno de los medicamentos elegidos no existe o está desactivado.');
      }

      // Lotes que se pueden entregar: con existencia y NO vencidos, el que vence antes primero
      // (como en una tienda: se vende primero la leche que vence antes). FOR UPDATE: nadie más los toca mientras tanto.
      const [lotes] = await conexion.query(
        `SELECT id_lote, existencia FROM tbl_lotes_medicamento
          WHERE id_medicamento = ? AND existencia > 0
            AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
          ORDER BY fecha_vencimiento IS NULL, fecha_vencimiento, id_lote
          FOR UPDATE`,
        [med.id_medicamento]
      );

      const disponible = lotes.reduce((suma, l) => suma + l.existencia, 0);

      if (disponible < linea.cantidad) {
        const vencido = med.existencia - disponible;
        throw new ErrorDespacho(
          `No hay existencia suficiente de ${`${med.nombre} ${med.presentacion}`.trim()}: hay ${disponible} disponible(s) y se pidieron ${linea.cantidad}.`
          + (vencido > 0 ? ` (Hay ${vencido} vencida(s) que no se pueden entregar.)` : '')
          + ' Despacha solo lo que hay (despacho parcial).'
        );
      }

      // Se va sacando lote por lote hasta completar la cantidad
      const salidas = [];
      let falta = linea.cantidad;

      for (const lote of lotes) {
        if (falta === 0) break;
        const saca = Math.min(falta, lote.existencia);

        await conexion.query(
          `UPDATE tbl_lotes_medicamento SET existencia = existencia - ? WHERE id_lote = ?`,
          [saca, lote.id_lote]
        );
        salidas.push({ id_lote: lote.id_lote, cantidad: saca });
        falta -= saca;
      }

      await conexion.query(
        `UPDATE tbl_medicamentos SET existencia = existencia - ? WHERE id_medicamento = ?`,
        [linea.cantidad, med.id_medicamento]
      );

      let idReceta = null;
      let idPsicopatologia = null;

      if (linea.tipo === 'receta') {
        const [rec] = await conexion.query(
          `UPDATE tbl_recetas_visita r
             JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita
              SET r.cantidad_despachada = r.cantidad_despachada + ?, r.sin_existencia = 0
            WHERE r.id_receta = ? AND v.id_interno = ? AND v.estado = 'Registrada'
              AND r.cantidad_despachada + ? <= r.cantidad`,
          [linea.cantidad, linea.id_origen, idInterno, linea.cantidad]
        );

        if (rec.affectedRows === 0) {
          throw new ErrorDespacho(await explicarReceta(conexion, linea.id_origen));
        }

        const [[fila]] = await conexion.query(`SELECT id_visita FROM tbl_recetas_visita WHERE id_receta = ?`, [linea.id_origen]);
        visitas.add(fila.id_visita);
        idReceta = linea.id_origen;
      } else {
        // FA-03: el cajón se despacha contra el padecimiento del interno, no contra una receta
        const [[cajon]] = await conexion.query(
          `SELECT id_psicopatologia FROM tbl_psicopatologias
            WHERE id_psicopatologia = ? AND id_interno = ? AND anulada = 0
              AND medicamento_cajon IS NOT NULL AND medicamento_cajon <> ''`,
          [linea.id_origen, idInterno]
        );

        if (!cajon) {
          throw new ErrorDespacho('Uno de los medicamentos de cajón ya no está vigente para este interno.');
        }
        idPsicopatologia = linea.id_origen;
      }

      const subtotal = Math.round(Number(med.precio) * linea.cantidad * 100) / 100;

      await conexion.query(
        `INSERT INTO tbl_medicamentos_despachados
           (id_despacho, id_medicamento, id_receta, id_psicopatologia, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [idDespacho, med.id_medicamento, idReceta, idPsicopatologia, linea.cantidad, med.precio, subtotal]
      );

      // Un movimiento por cada lote del que salió: así se sabe qué lote recibió cada interno
      for (const salida of salidas) {
        await conexion.query(
          `INSERT INTO tbl_movimientos_medicamento (id_medicamento, id_lote, tipo, cantidad, id_usuario, id_despacho)
           VALUES (?, ?, 'Despacho', ?, ?, ?)`,
          [med.id_medicamento, salida.id_lote, salida.cantidad, idFarmaceutico, idDespacho]
        );
      }
    }

    if (idDespacho) {
      await conexion.query(
        `UPDATE tbl_despachos
            SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM tbl_medicamentos_despachados WHERE id_despacho = ?)
          WHERE id_despacho = ?`,
        [idDespacho, idDespacho]
      );
    }

    // FA-02: lo que la farmacia no tiene queda marcado para que el especialista lo vea
    if (sinExistencia.length > 0) {
      await conexion.query(
        `UPDATE tbl_recetas_visita r
           JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita
            SET r.sin_existencia = 1
          WHERE r.id_receta IN (?) AND v.id_interno = ? AND v.estado = 'Registrada'
            AND r.cantidad_despachada < r.cantidad`,
        [sinExistencia, idInterno]
      );
    }

    // RN9: el costo de las recetas despachadas va a la cuenta de su visita
    for (const idVisita of visitas) {
      const [[suma]] = await conexion.query(
        `SELECT COALESCE(SUM(dd.subtotal), 0) AS total
           FROM tbl_medicamentos_despachados dd
           JOIN tbl_recetas_visita r ON r.id_receta = dd.id_receta
          WHERE r.id_visita = ?`,
        [idVisita]
      );

      await conexion.query(
        `UPDATE tbl_visitas_medicas
            SET costo_medicamentos = ?,
                estado_costo = IF(costo_consulta + costo_examenes + ? > 0, 'Pendiente de cálculo', 'Sin cargos')
          WHERE id_visita = ?`,
        [suma.total, suma.total, idVisita]
      );
    }

    await conexion.commit();
    return { idDespacho, visitas: [...visitas] };
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// El comprobante: encabezado y líneas
async function buscarDespacho(id) {
  const [[encabezado]] = await pool.query(
    `SELECT d.id_despacho, d.id_interno, d.total,
            DATE_FORMAT(d.fecha, '%d/%m/%Y %H:%i') AS fecha_texto,
            ${NOMBRE_INTERNO} AS interno_nombre, i.dpi AS interno_dpi,
            CONCAT_WS(' ', f.nombre1, f.apellido1) AS farmaceutico_nombre
       FROM tbl_despachos d
       JOIN tbl_internos i ON i.id_interno = d.id_interno
       JOIN tbl_usuarios f ON f.id_usuario = d.id_farmaceutico
      WHERE d.id_despacho = ?`,
    [id]
  );

  if (!encabezado) return undefined;

  const [lineas] = await pool.query(
    `SELECT dd.cantidad, dd.precio_unitario, dd.subtotal,
            m.nombre, m.presentacion,
            dd.id_receta, r.id_visita, r.medicamento AS recetado,
            dd.id_psicopatologia, p.nombre_padecimiento
       FROM tbl_medicamentos_despachados dd
       JOIN tbl_medicamentos m ON m.id_medicamento = dd.id_medicamento
       LEFT JOIN tbl_recetas_visita r ON r.id_receta = dd.id_receta
       LEFT JOIN tbl_psicopatologias p ON p.id_psicopatologia = dd.id_psicopatologia
      WHERE dd.id_despacho = ?
      ORDER BY dd.id_detalle`,
    [id]
  );

  return { ...encabezado, lineas };
}

// Historial de despachos
async function listarDespachos(busqueda) {
  let sql = `
    SELECT d.id_despacho, d.total,
           DATE_FORMAT(d.fecha, '%d/%m/%Y %H:%i') AS fecha_texto,
           ${NOMBRE_INTERNO} AS interno_nombre,
           CONCAT_WS(' ', f.nombre1, f.apellido1) AS farmaceutico_nombre,
           (SELECT COUNT(*) FROM tbl_medicamentos_despachados dd WHERE dd.id_despacho = d.id_despacho) AS lineas
      FROM tbl_despachos d
      JOIN tbl_internos i ON i.id_interno = d.id_interno
      JOIN tbl_usuarios f ON f.id_usuario = d.id_farmaceutico
  `;
  const valores = [];

  if (busqueda) {
    sql += ` WHERE ${NOMBRE_INTERNO} LIKE ?`;
    valores.push(`%${busqueda}%`);
  }

  sql += ` ORDER BY d.fecha DESC, d.id_despacho DESC LIMIT 200`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

module.exports = {
  ErrorDespacho, cola, buscarInterno, recetasPendientes, recetasDespachadas, medicamentosCajon,
  despachar, buscarDespacho, listarDespachos
};
