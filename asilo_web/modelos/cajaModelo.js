const pool = require('../config/baseDatos');

// INGRESOS Y EGRESOS (RN15) y DEUDA CON LA FUNDACIÓN (RQ7).
// Nada se borra: un registro equivocado se anula con su motivo y deja de contar en la caja.

const PROCEDENCIAS = ['Empresa internacional', 'Empresa nacional', 'Gobierno', 'Persona particular'];
const CONCEPTOS_GASTO = ['Energía eléctrica', 'Agua potable', 'Teléfono e internet', 'Alimentación',
  'Limpieza', 'Mantenimiento', 'Salarios', 'Transporte', 'Otro'];
const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Depósito', 'Cheque'];

const USUARIO = `CONCAT_WS(' ', u.nombre1, u.apellido1) AS usuario_nombre`;

// ===== Donaciones =====
async function donaciones(desde, hasta) {
  const [filas] = await pool.query(
    `SELECT d.id_donacion, d.procedencia, d.donante, d.monto, d.descripcion, d.anulado, d.motivo_anulacion,
            DATE_FORMAT(d.fecha, '%d/%m/%Y') AS fecha_texto, ${USUARIO}
       FROM tbl_donaciones d JOIN tbl_usuarios u ON u.id_usuario = d.id_usuario
      WHERE d.fecha BETWEEN ? AND ?
      ORDER BY d.fecha DESC, d.id_donacion DESC`,
    [desde, hasta]
  );
  return filas;
}

// Total por procedencia (para el resumen de la pantalla)
async function donacionesPorProcedencia(desde, hasta) {
  const [filas] = await pool.query(
    `SELECT procedencia, COUNT(*) AS cantidad, SUM(monto) AS total
       FROM tbl_donaciones WHERE anulado = 0 AND fecha BETWEEN ? AND ?
      GROUP BY procedencia ORDER BY total DESC`,
    [desde, hasta]
  );
  return filas;
}

async function crearDonacion(d, idUsuario) {
  const [r] = await pool.query(
    `INSERT INTO tbl_donaciones (procedencia, donante, monto, fecha, descripcion, id_usuario) VALUES (?, ?, ?, ?, ?, ?)`,
    [d.procedencia, d.donante, d.monto, d.fecha, d.descripcion, idUsuario]
  );
  return r.insertId;
}

// ===== Gastos operativos =====
async function gastos(desde, hasta) {
  const [filas] = await pool.query(
    `SELECT g.id_gasto, g.concepto, g.descripcion, g.monto, g.anulado, g.motivo_anulacion,
            DATE_FORMAT(g.fecha, '%d/%m/%Y') AS fecha_texto, ${USUARIO}
       FROM tbl_gastos_operativos g JOIN tbl_usuarios u ON u.id_usuario = g.id_usuario
      WHERE g.fecha BETWEEN ? AND ?
      ORDER BY g.fecha DESC, g.id_gasto DESC`,
    [desde, hasta]
  );
  return filas;
}

async function crearGasto(g, idUsuario) {
  const [r] = await pool.query(
    `INSERT INTO tbl_gastos_operativos (concepto, descripcion, monto, fecha, id_usuario) VALUES (?, ?, ?, ?, ?)`,
    [g.concepto, g.descripcion, g.monto, g.fecha, idUsuario]
  );
  return r.insertId;
}

// ===== Pagos a la Fundación =====
async function pagosFundacion() {
  const [filas] = await pool.query(
    `SELECT p.id_pago_fundacion, p.monto, p.forma_pago, p.referencia, p.observacion, p.anulado, p.motivo_anulacion,
            DATE_FORMAT(p.fecha, '%d/%m/%Y') AS fecha_texto, ${USUARIO}
       FROM tbl_pagos_fundacion p JOIN tbl_usuarios u ON u.id_usuario = p.id_usuario
      ORDER BY p.fecha DESC, p.id_pago_fundacion DESC
      LIMIT 200`
  );
  return filas;
}

// Lo que el asilo le debe a la Fundación: lo facturado de sus servicios (ya con el 20%) menos lo que se le ha pagado
async function deudaFundacion() {
  const [[r]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_visitas_medicas WHERE estado_cobro <> 'Sin facturar') AS visitas,
            (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_despachos WHERE estado_cobro <> 'Sin facturar') AS medicamentos,
            (SELECT COALESCE(SUM(monto), 0) FROM tbl_pagos_fundacion WHERE anulado = 0) AS pagado`
  );
  const facturado = Number(r.visitas) + Number(r.medicamentos);
  const deuda = Math.round((facturado - Number(r.pagado)) * 100) / 100;
  return { visitas: Number(r.visitas), medicamentos: Number(r.medicamentos), facturado, pagado: Number(r.pagado), deuda };
}

// Se valida contra la deuda dentro de la transacción: dos pagos a la vez no pueden pasarse de lo que se debe
async function crearPagoFundacion(p, idUsuario) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    // Bloqueo simple: se toma la tabla de pagos a la Fundación mientras se calcula la deuda
    await conexion.query(`SELECT id_pago_fundacion FROM tbl_pagos_fundacion FOR UPDATE`);
    const { deuda } = await deudaFundacionCon(conexion);

    if (p.monto > deuda) {
      await conexion.rollback();
      return { error: `El pago (Q ${p.monto.toFixed(2)}) es mayor que la deuda con la Fundación (Q ${deuda.toFixed(2)}).` };
    }

    const [r] = await conexion.query(
      `INSERT INTO tbl_pagos_fundacion (monto, fecha, forma_pago, referencia, observacion, id_usuario) VALUES (?, ?, ?, ?, ?, ?)`,
      [p.monto, p.fecha, p.forma_pago, p.referencia, p.observacion, idUsuario]
    );
    await conexion.commit();
    return { id: r.insertId };
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function deudaFundacionCon(conexion) {
  const [[r]] = await conexion.query(
    `SELECT (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_visitas_medicas WHERE estado_cobro <> 'Sin facturar')
          + (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_despachos WHERE estado_cobro <> 'Sin facturar')
          - (SELECT COALESCE(SUM(monto), 0) FROM tbl_pagos_fundacion WHERE anulado = 0) AS deuda`
  );
  return { deuda: Math.round(Number(r.deuda) * 100) / 100 };
}

// ===== Anular (donación, gasto o pago a la Fundación) =====
const TABLAS_ANULABLES = {
  donacion: { tabla: 'tbl_donaciones', llave: 'id_donacion' },
  gasto: { tabla: 'tbl_gastos_operativos', llave: 'id_gasto' },
  fundacion: { tabla: 'tbl_pagos_fundacion', llave: 'id_pago_fundacion' }
};

async function anular(tipo, id, motivo) {
  const t = TABLAS_ANULABLES[tipo];
  const [r] = await pool.query(
    `UPDATE ${t.tabla} SET anulado = 1, motivo_anulacion = ? WHERE ${t.llave} = ? AND anulado = 0`,
    [motivo, id]
  );
  return r.affectedRows;
}

// ===== Libro de caja =====
// Todas las entradas (pagos de familiares, donaciones) y salidas (gastos, pagos a la Fundación) de un rango,
// sin lo anulado. El saldo inicial es todo lo anterior al rango.
const SQL_MOVIMIENTOS = `
  SELECT DATE(p.fecha) AS fecha, 'Entrada' AS tipo, 'Pago de familiar' AS origen,
         CONCAT(f.nombre_completo, ' · ', IF(p.id_cuota IS NOT NULL, 'CUOTA', IF(p.id_visita IS NOT NULL, CONCAT('VISITA #', p.id_visita), CONCAT('MEDICAMENTOS #', p.id_despacho))),
                ' · ', p.forma_pago) AS detalle,
         p.monto
    FROM tbl_pagos p JOIN tbl_familiares_responsables f ON f.id_familiar = p.id_familiar
   WHERE p.anulado = 0
  UNION ALL
  SELECT d.fecha, 'Entrada', 'Donación', CONCAT(d.donante, ' · ', d.procedencia), d.monto
    FROM tbl_donaciones d WHERE d.anulado = 0
  UNION ALL
  SELECT g.fecha, 'Salida', 'Gasto operativo', CONCAT(g.concepto, IF(g.descripcion <> '', CONCAT(' · ', g.descripcion), '')), g.monto
    FROM tbl_gastos_operativos g WHERE g.anulado = 0
  UNION ALL
  SELECT pf.fecha, 'Salida', 'Pago a la Fundación', CONCAT(pf.forma_pago, IF(pf.referencia <> '', CONCAT(' · ', pf.referencia), '')), pf.monto
    FROM tbl_pagos_fundacion pf WHERE pf.anulado = 0
`;

async function libroCaja(desde, hasta) {
  const [movimientos] = await pool.query(
    `SELECT m.*, DATE_FORMAT(m.fecha, '%d/%m/%Y') AS fecha_texto
       FROM (${SQL_MOVIMIENTOS}) m
      WHERE m.fecha BETWEEN ? AND ?
      ORDER BY m.fecha, m.tipo`,
    [desde, hasta]
  );

  const [[anterior]] = await pool.query(
    `SELECT COALESCE(SUM(IF(m.tipo = 'Entrada', m.monto, -m.monto)), 0) AS saldo
       FROM (${SQL_MOVIMIENTOS}) m WHERE m.fecha < ?`,
    [desde]
  );

  // Saldo después de cada movimiento (como en una libreta de banco)
  let saldo = Number(anterior.saldo);
  let entradas = 0;
  let salidas = 0;
  const filas = movimientos.map((m) => {
    const monto = Number(m.monto);
    if (m.tipo === 'Entrada') { saldo += monto; entradas += monto; } else { saldo -= monto; salidas += monto; }
    return { ...m, saldo: (Math.round(saldo * 100) / 100).toFixed(2) };
  });

  const r = (n) => (Math.round(n * 100) / 100).toFixed(2);
  return {
    filas,
    saldoInicial: r(Number(anterior.saldo)),
    entradas: r(entradas),
    salidas: r(salidas),
    saldoFinal: r(saldo)
  };
}

module.exports = {
  PROCEDENCIAS, CONCEPTOS_GASTO, FORMAS_PAGO,
  donaciones, donacionesPorProcedencia, crearDonacion,
  gastos, crearGasto,
  pagosFundacion, deudaFundacion, crearPagoFundacion,
  anular, libroCaja
};
