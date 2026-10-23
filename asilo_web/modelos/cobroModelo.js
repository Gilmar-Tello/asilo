const pool = require('../config/baseDatos');

// COBROS A FAMILIARES: cuotas mensuales (RN14), visitas facturadas (RN9/RN10) y medicamentos sin visita.
// Cada cargo guarda su monto y lo pagado; el saldo del familiar se recalcula SIEMPRE desde los cargos,
// así nunca se "descuadra" (no se suma y resta a mano).

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;

// Error de una regla del negocio: el mensaje se le muestra al usuario
class ErrorCobro extends Error {
  constructor(mensaje) { super(mensaje); this.deNegocio = true; }
}

// Recalcula el saldo pendiente del familiar (lo que debe = cargos - pagado)
async function recalcularSaldo(conexion, idFamiliar) {
  if (!idFamiliar) return;
  await conexion.query(
    `UPDATE tbl_familiares_responsables f
        SET f.saldo_pendiente =
              (SELECT COALESCE(SUM(c.monto - c.monto_pagado), 0) FROM tbl_cuotas_mensuales c WHERE c.id_familiar = f.id_familiar)
            + (SELECT COALESCE(SUM(v.monto_facturado - v.monto_pagado), 0) FROM tbl_visitas_medicas v
                WHERE v.id_familiar_cobro = f.id_familiar AND v.estado_cobro <> 'Sin facturar')
            + (SELECT COALESCE(SUM(d.monto_facturado - d.monto_pagado), 0) FROM tbl_despachos d
                WHERE d.id_familiar_cobro = f.id_familiar AND d.estado_cobro <> 'Sin facturar')
      WHERE f.id_familiar = ?`,
    [idFamiliar]
  );
}

// Todos los cargos de un familiar (o de todos), en una sola lista: cuota, visita o medicamentos
const SQL_CARGOS = `
  SELECT 'cuota' AS tipo, c.id_cuota AS id_cargo, c.id_familiar,
         CONCAT('CUOTA ', UPPER(DATE_FORMAT(c.mes, '%m/%Y'))) AS descripcion,
         ${NOMBRE_INTERNO} AS interno_nombre, c.monto, c.monto_pagado, c.estado,
         c.mes AS fecha_orden, DATE_FORMAT(c.mes, '%m/%Y') AS fecha_texto
    FROM tbl_cuotas_mensuales c JOIN tbl_internos i ON i.id_interno = c.id_interno
  UNION ALL
  SELECT 'visita', v.id_visita, v.id_familiar_cobro,
         CONCAT('VISITA MÉDICA #', v.id_visita, ' · ', COALESCE(e.nombre, 'ESPECIALISTA')),
         ${NOMBRE_INTERNO}, v.monto_facturado, v.monto_pagado, v.estado_cobro,
         v.fecha_visita, DATE_FORMAT(v.fecha_visita, '%d/%m/%Y')
    FROM tbl_visitas_medicas v
    JOIN tbl_internos i ON i.id_interno = v.id_interno
    JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
    LEFT JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
   WHERE v.estado_cobro <> 'Sin facturar'
  UNION ALL
  SELECT 'despacho', d.id_despacho, d.id_familiar_cobro,
         CONCAT('MEDICAMENTOS · DESPACHO #', d.id_despacho),
         ${NOMBRE_INTERNO}, d.monto_facturado, d.monto_pagado, d.estado_cobro,
         d.fecha, DATE_FORMAT(d.fecha, '%d/%m/%Y')
    FROM tbl_despachos d JOIN tbl_internos i ON i.id_interno = d.id_interno
   WHERE d.estado_cobro <> 'Sin facturar'
`;

// Familiares con su saldo y cuántos cargos pendientes tienen
async function cuentas(busqueda) {
  let sql = `
    SELECT f.id_familiar, f.nombre_completo, f.dpi, f.telefono, f.correo_electronico, f.saldo_pendiente, f.estado,
           (SELECT COUNT(*) FROM (${SQL_CARGOS}) x WHERE x.id_familiar = f.id_familiar AND x.estado = 'Pendiente de Pago') AS pendientes
      FROM tbl_familiares_responsables f
  `;
  const valores = [];
  if (busqueda) {
    sql += ` WHERE f.nombre_completo LIKE ? OR f.dpi LIKE ?`;
    valores.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  sql += ` ORDER BY f.saldo_pendiente DESC, f.nombre_completo LIMIT 200`;
  const [filas] = await pool.query(sql, valores);
  return filas;
}

async function buscarFamiliar(id) {
  const [[f]] = await pool.query(
    `SELECT id_familiar, nombre_completo, dpi, telefono, correo_electronico, saldo_pendiente, estado
       FROM tbl_familiares_responsables WHERE id_familiar = ?`,
    [id]
  );
  return f;
}

// Estado de cuenta: cargos (lo pendiente primero) y pagos
async function estadoCuenta(idFamiliar) {
  const [cargos] = await pool.query(
    `SELECT x.*, x.monto - x.monto_pagado AS saldo
       FROM (${SQL_CARGOS}) x
      WHERE x.id_familiar = ?
      ORDER BY (x.estado = 'Pendiente de Pago') DESC, x.fecha_orden DESC`,
    [idFamiliar]
  );

  const [pagos] = await pool.query(
    `SELECT p.id_pago, p.monto, p.forma_pago, p.referencia, p.anulado, p.motivo_anulacion,
            p.id_cuota, p.id_visita, p.id_despacho,
            DATE_FORMAT(p.fecha, '%d/%m/%Y %H:%i') AS fecha_texto,
            CONCAT_WS(' ', u.nombre1, u.apellido1) AS usuario_nombre
       FROM tbl_pagos p JOIN tbl_usuarios u ON u.id_usuario = p.id_usuario
      WHERE p.id_familiar = ?
      ORDER BY p.fecha DESC, p.id_pago DESC
      LIMIT 100`,
    [idFamiliar]
  );

  return { cargos, pagos };
}

// Dónde está cada tipo de cargo (tabla, llave y nombre de la columna de estado)
const DESTINOS = {
  cuota:    { tabla: 'tbl_cuotas_mensuales', llave: 'id_cuota',    familiar: 'id_familiar',       estado: 'estado',       monto: 'monto',           fecha: 'fecha_pago' },
  visita:   { tabla: 'tbl_visitas_medicas',  llave: 'id_visita',   familiar: 'id_familiar_cobro', estado: 'estado_cobro', monto: 'monto_facturado', fecha: 'fecha_cancelacion' },
  despacho: { tabla: 'tbl_despachos',        llave: 'id_despacho', familiar: 'id_familiar_cobro', estado: 'estado_cobro', monto: 'monto_facturado', fecha: 'fecha_cancelacion' }
};

// Aplica lo pagado al cargo. RN10: pasa a "Cancelada" SOLO cuando se cubre el total;
// un pago parcial deja el estado en "Pendiente de Pago".
async function ajustarCargo(conexion, d, idCargo, diferencia) {
  await conexion.query(
    `UPDATE ${d.tabla}
        SET monto_pagado = monto_pagado + ?,
            ${d.estado} = IF(monto_pagado >= ${d.monto}, 'Cancelada', 'Pendiente de Pago'),
            ${d.fecha} = IF(monto_pagado >= ${d.monto}, COALESCE(${d.fecha}, NOW()), NULL)
      WHERE ${d.llave} = ?`,
    [diferencia, idCargo]
  );
}

// Registra un pago (parcial o total) a UN cargo del familiar
async function registrarPago({ idFamiliar, tipo, idCargo, monto, formaPago, referencia, idUsuario }) {
  const d = DESTINOS[tipo];
  if (!d) throw new ErrorCobro('El cargo no es válido.');

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    // FOR UPDATE: si dos personas cobran a la vez el mismo cargo, la segunda espera y ve el saldo nuevo
    const [[cargo]] = await conexion.query(
      `SELECT ${d.monto} AS monto, monto_pagado, ${d.estado} AS estado, ${d.familiar} AS id_familiar
         FROM ${d.tabla} WHERE ${d.llave} = ? FOR UPDATE`,
      [idCargo]
    );

    if (!cargo || cargo.id_familiar !== idFamiliar) throw new ErrorCobro('Ese cargo no es de este familiar.');
    if (cargo.estado !== 'Pendiente de Pago') throw new ErrorCobro('Ese cargo ya está cancelado.');

    const saldo = Math.round((Number(cargo.monto) - Number(cargo.monto_pagado)) * 100) / 100;
    if (monto > saldo) throw new ErrorCobro(`El pago (Q ${monto.toFixed(2)}) es mayor que lo que se debe de ese cargo (Q ${saldo.toFixed(2)}).`);

    const [r] = await conexion.query(
      `INSERT INTO tbl_pagos (id_familiar, ${d.llave}, monto, forma_pago, referencia, id_usuario) VALUES (?, ?, ?, ?, ?, ?)`,
      [idFamiliar, idCargo, monto, formaPago, referencia, idUsuario]
    );

    await ajustarCargo(conexion, d, idCargo, monto);
    await recalcularSaldo(conexion, idFamiliar);

    await conexion.commit();
    return r.insertId;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Anula un pago (se conserva con su motivo): lo pagado vuelve a deberse y el cargo regresa a "Pendiente de Pago"
async function anularPago(idPago, motivo) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[pago]] = await conexion.query(
      `SELECT id_pago, id_familiar, id_cuota, id_visita, id_despacho, monto FROM tbl_pagos
        WHERE id_pago = ? AND anulado = 0 FOR UPDATE`,
      [idPago]
    );
    if (!pago) { await conexion.rollback(); return null; }

    await conexion.query(`UPDATE tbl_pagos SET anulado = 1, motivo_anulacion = ? WHERE id_pago = ?`, [motivo, idPago]);

    const tipo = pago.id_cuota ? 'cuota' : (pago.id_visita ? 'visita' : 'despacho');
    await ajustarCargo(conexion, DESTINOS[tipo], pago.id_cuota || pago.id_visita || pago.id_despacho, -Number(pago.monto));
    await recalcularSaldo(conexion, pago.id_familiar);

    await conexion.commit();
    return pago.id_familiar;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// ===== Cuotas mensuales (RN14) =====

// Internos activos con su familiar, su cuota habitual y si ya tienen la cuota de ese mes
async function internosParaCuotas(mes) {
  const [filas] = await pool.query(
    `SELECT i.id_interno, ${NOMBRE_INTERNO} AS interno_nombre, i.cuota_mensual,
            f.id_familiar, f.nombre_completo AS familiar_nombre,
            c.id_cuota, c.monto AS monto_generado, c.estado AS estado_cuota
       FROM tbl_internos i
       JOIN tbl_familiares_responsables f ON f.id_familiar = i.id_familiar
       LEFT JOIN tbl_cuotas_mensuales c ON c.id_interno = i.id_interno AND c.mes = ?
      WHERE i.estado = 1
      ORDER BY i.apellido1, i.nombre1`,
    [mes]
  );
  return filas;
}

// Genera las cuotas del mes. items: [{ id_interno, monto }]. Las que ya existen se saltan (no se duplican).
// Devuelve { creadas, existentes, nuevas (ids) }
async function generarCuotas(mes, items) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    let creadas = 0;
    let existentes = 0;
    const nuevas = [];   // ids de las cuotas creadas (para avisar a cada familiar)
    const familiares = new Set();

    for (const item of items) {
      const [[interno]] = await conexion.query(
        `SELECT id_interno, id_familiar FROM tbl_internos WHERE id_interno = ? AND estado = 1`,
        [item.id_interno]
      );
      if (!interno) continue;

      // INSERT IGNORE + la llave única (interno, mes): aunque se envíe dos veces, la cuota existe una sola vez
      const [r] = await conexion.query(
        `INSERT IGNORE INTO tbl_cuotas_mensuales (id_interno, id_familiar, mes, monto) VALUES (?, ?, ?, ?)`,
        [interno.id_interno, interno.id_familiar, mes, item.monto]
      );

      if (r.affectedRows === 1) {
        creadas++;
        nuevas.push(r.insertId);
        familiares.add(interno.id_familiar);
        // La cuota usada queda como la habitual del interno (se propondrá el mes siguiente)
        await conexion.query(`UPDATE tbl_internos SET cuota_mensual = ? WHERE id_interno = ?`, [item.monto, interno.id_interno]);
      } else {
        existentes++;
      }
    }

    for (const idFamiliar of familiares) {
      await recalcularSaldo(conexion, idFamiliar);
    }

    await conexion.commit();
    return { creadas, existentes, nuevas };
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// ===== Facturación (RN2, RN9) =====

// Visitas listas para cobrar: con diagnóstico, cerradas, con costo calculado y que no se han facturado
async function visitasPorFacturar() {
  const [filas] = await pool.query(
    `SELECT v.id_visita, v.total, v.subtotal, v.descuento, v.diagnostico,
            DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha_texto,
            ${NOMBRE_INTERNO} AS interno_nombre, f.nombre_completo AS familiar_nombre,
            COALESCE(e.nombre, '') AS especialidad
       FROM tbl_visitas_medicas v
       JOIN tbl_internos i ON i.id_interno = v.id_interno
       JOIN tbl_familiares_responsables f ON f.id_familiar = i.id_familiar
       JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
       LEFT JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
      WHERE v.estado = 'Registrada' AND v.cerrada = 1 AND v.estado_costo = 'Calculado'
        AND v.estado_cobro = 'Sin facturar' AND v.total > 0 AND v.diagnostico IS NOT NULL
      ORDER BY v.fecha_visita`
  );
  return filas;
}

// Visitas que todavía no se pueden facturar (para explicar por qué)
async function visitasEnEspera() {
  const [filas] = await pool.query(
    `SELECT v.id_visita, DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha_texto,
            ${NOMBRE_INTERNO} AS interno_nombre, v.cerrada, v.estado_costo
       FROM tbl_visitas_medicas v
       JOIN tbl_internos i ON i.id_interno = v.id_interno
      WHERE v.estado = 'Registrada' AND v.estado_cobro = 'Sin facturar'
        AND (v.cerrada = 0 OR v.estado_costo = 'Pendiente de cálculo')
      ORDER BY v.fecha_visita`
  );
  return filas;
}

// Despachos con medicamentos de cajón o del médico general que no se han cobrado (lo de visitas va en la visita)
async function despachosPorFacturar() {
  const [filas] = await pool.query(
    `SELECT d.id_despacho, DATE_FORMAT(d.fecha, '%d/%m/%Y') AS fecha_texto,
            ${NOMBRE_INTERNO} AS interno_nombre, f.nombre_completo AS familiar_nombre,
            (SELECT COALESCE(SUM(dd.subtotal), 0) FROM tbl_medicamentos_despachados dd
              WHERE dd.id_despacho = d.id_despacho AND dd.id_receta IS NULL) AS bruto
       FROM tbl_despachos d
       JOIN tbl_internos i ON i.id_interno = d.id_interno
       JOIN tbl_familiares_responsables f ON f.id_familiar = i.id_familiar
      WHERE d.estado_cobro = 'Sin facturar'
     HAVING bruto > 0
      ORDER BY d.fecha`
  );
  return filas;
}

// Factura una visita: su total (ya con el 20%) pasa a la cuenta del familiar responsable del interno
async function facturarVisita(idVisita) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[v]] = await conexion.query(
      `SELECT v.id_visita, v.total, i.id_familiar
         FROM tbl_visitas_medicas v JOIN tbl_internos i ON i.id_interno = v.id_interno
        WHERE v.id_visita = ? AND v.estado = 'Registrada' AND v.cerrada = 1 AND v.estado_costo = 'Calculado'
          AND v.estado_cobro = 'Sin facturar' AND v.total > 0 AND v.diagnostico IS NOT NULL
        FOR UPDATE`,
      [idVisita]
    );
    if (!v) { await conexion.rollback(); return false; }

    await conexion.query(
      `UPDATE tbl_visitas_medicas
          SET estado_cobro = 'Pendiente de Pago', id_familiar_cobro = ?, monto_facturado = total, fecha_facturacion = NOW()
        WHERE id_visita = ?`,
      [v.id_familiar, idVisita]
    );
    await recalcularSaldo(conexion, v.id_familiar);

    await conexion.commit();
    return true;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Factura un despacho con los importes que devolvió el microservicio de costos
async function facturarDespacho(idDespacho, costos) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[d]] = await conexion.query(
      `SELECT d.id_despacho, i.id_familiar FROM tbl_despachos d JOIN tbl_internos i ON i.id_interno = d.id_interno
        WHERE d.id_despacho = ? AND d.estado_cobro = 'Sin facturar' FOR UPDATE`,
      [idDespacho]
    );
    if (!d) { await conexion.rollback(); return false; }

    await conexion.query(
      `UPDATE tbl_despachos
          SET estado_cobro = 'Pendiente de Pago', id_familiar_cobro = ?, monto_bruto = ?, descuento = ?,
              monto_facturado = ?, fecha_facturacion = NOW()
        WHERE id_despacho = ?`,
      [d.id_familiar, costos.subtotal, costos.descuento, costos.total, idDespacho]
    );
    await recalcularSaldo(conexion, d.id_familiar);

    await conexion.commit();
    return true;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Lo que todavía no se puede cobrar de un despacho (bruto de cajón + médico general)
async function brutoDespacho(idDespacho) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(subtotal), 0) AS bruto FROM tbl_medicamentos_despachados WHERE id_despacho = ? AND id_receta IS NULL`,
    [idDespacho]
  );
  return Number(r.bruto);
}

// ===== Datos para los correos al familiar =====
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Un cargo en palabras para el familiar: "Cuota mensual de octubre de 2026", "Visita médica del 06/10/2026"...
async function detalleCargo(tipo, id) {
  const consultas = {
    cuota: `SELECT id_familiar, id_interno, monto, DATE_FORMAT(mes, '%Y-%m') AS clave FROM tbl_cuotas_mensuales WHERE id_cuota = ?`,
    visita: `SELECT id_familiar_cobro AS id_familiar, id_interno, monto_facturado AS monto, DATE_FORMAT(fecha_visita, '%d/%m/%Y') AS clave FROM tbl_visitas_medicas WHERE id_visita = ?`,
    despacho: `SELECT id_familiar_cobro AS id_familiar, id_interno, monto_facturado AS monto, DATE_FORMAT(fecha, '%d/%m/%Y') AS clave FROM tbl_despachos WHERE id_despacho = ?`
  };
  if (!consultas[tipo]) return null;
  const [[c]] = await pool.query(consultas[tipo], [id]);
  if (!c) return null;

  let concepto;
  if (tipo === 'cuota') {
    const [anio, mes] = c.clave.split('-').map(Number);
    concepto = `Cuota mensual de ${MESES[mes - 1]} de ${anio}`;
  } else if (tipo === 'visita') {
    concepto = `Visita médica del ${c.clave}`;   // sin especialidad ni diagnóstico: el correo no lleva datos clínicos
  } else {
    concepto = `Medicamentos despachados el ${c.clave}`;
  }
  return { id_familiar: c.id_familiar, id_interno: c.id_interno, monto: Number(c.monto), concepto };
}

// Un pago (aunque esté anulado) con el cargo al que se aplicó
async function detallePago(idPago) {
  const [[p]] = await pool.query(
    `SELECT id_pago, id_familiar, id_cuota, id_visita, id_despacho, monto, forma_pago, referencia, motivo_anulacion
       FROM tbl_pagos WHERE id_pago = ?`,
    [idPago]
  );
  if (!p) return null;
  const tipo = p.id_cuota ? 'cuota' : (p.id_visita ? 'visita' : 'despacho');
  const cargo = await detalleCargo(tipo, p.id_cuota || p.id_visita || p.id_despacho);
  return { ...p, monto: Number(p.monto), id_interno: cargo ? cargo.id_interno : null, concepto: cargo ? cargo.concepto : '' };
}

module.exports = {
  detalleCargo, detallePago,
  ErrorCobro, recalcularSaldo, cuentas, buscarFamiliar, estadoCuenta, registrarPago, anularPago,
  internosParaCuotas, generarCuotas,
  visitasPorFacturar, visitasEnEspera, despachosPorFacturar, facturarVisita, facturarDespacho, brutoDespacho
};
