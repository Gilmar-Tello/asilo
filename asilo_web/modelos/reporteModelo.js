const pool = require('../config/baseDatos');
const cajaModelo = require('./cajaModelo');

// REPORTES E INFORMES (CU-08 / RQ8)
// Cada reporte devuelve la MISMA forma de datos, sin importar si se verá en pantalla, en PDF o en Excel:
//   { resumen: [{ etiqueta, valor, tipo }], secciones: [{ titulo, columnas, filas, totales, vacio }] }
//   columnas: [{ titulo, campo, tipo: 'texto' | 'dinero' | 'numero', ancho }]   (ancho: peso relativo para el PDF)
// Así, agregar un reporte nuevo es solo escribir su consulta: las tres "impresoras" ya saben dibujarlo.

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;
const NOMBRE_USUARIO = (a) => `CONCAT_WS(' ', ${a}.titulo, ${a}.nombre1, ${a}.apellido1)`;

const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const sumar = (filas, campo) => num(filas.reduce((s, f) => s + Number(f[campo] || 0), 0));

// Totales de las columnas de dinero (y de las numéricas que se pidan)
function totalesDe(filas, campos) {
  const t = {};
  for (const c of campos) t[c] = sumar(filas, c);
  return t;
}

// Filtro de fechas sobre una columna; si no hay rango, no filtra
function filtroFecha(columna, f, valores) {
  if (!f.desde || !f.hasta) return '';
  valores.push(f.desde, f.hasta);
  return ` AND DATE(${columna}) BETWEEN ? AND ?`;
}

function filtroInterno(columna, f, valores) {
  if (!f.idInterno) return '';
  valores.push(f.idInterno);
  return ` AND ${columna} = ?`;
}

// ---------- 1. Costos por paciente ----------
async function costos(f) {
  const v1 = [];
  const [visitas] = await pool.query(
    `SELECT ${NOMBRE_INTERNO} AS interno, COUNT(*) AS visitas,
            SUM(v.costo_consulta) AS consulta, SUM(v.costo_examenes) AS examenes, SUM(v.costo_medicamentos) AS medicamentos,
            SUM(v.subtotal) AS subtotal, SUM(v.descuento) AS descuento, SUM(v.total) AS total
       FROM tbl_visitas_medicas v JOIN tbl_internos i ON i.id_interno = v.id_interno
      WHERE v.estado = 'Registrada'${filtroFecha('v.fecha_visita', f, v1)}${filtroInterno('v.id_interno', f, v1)}
      GROUP BY i.id_interno ORDER BY total DESC`,
    v1
  );

  // Medicinas que no salieron de una visita (médico general y cajón): se cobran aparte
  const v2 = [];
  const [fuera] = await pool.query(
    `SELECT ${NOMBRE_INTERNO} AS interno, COUNT(DISTINCT d.id_despacho) AS despachos, SUM(dd.subtotal) AS bruto
       FROM tbl_medicamentos_despachados dd
       JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
       JOIN tbl_internos i ON i.id_interno = d.id_interno
      WHERE dd.id_receta IS NULL${filtroFecha('d.fecha', f, v2)}${filtroInterno('d.id_interno', f, v2)}
      GROUP BY i.id_interno ORDER BY bruto DESC`,
    v2
  );

  const tv = totalesDe(visitas, ['visitas', 'consulta', 'examenes', 'medicamentos', 'subtotal', 'descuento', 'total']);
  const tf = totalesDe(fuera, ['despachos', 'bruto']);

  return {
    resumen: [
      { etiqueta: 'Visitas registradas', valor: tv.visitas, tipo: 'numero' },
      { etiqueta: 'Costo bruto de visitas', valor: tv.subtotal, tipo: 'dinero' },
      { etiqueta: 'Descuento de la Fundación', valor: tv.descuento, tipo: 'dinero' },
      { etiqueta: 'Total de visitas', valor: tv.total, tipo: 'dinero' },
      { etiqueta: 'Medicinas fuera de visita', valor: tf.bruto, tipo: 'dinero' }
    ],
    secciones: [
      {
        titulo: 'Visitas médicas con especialista',
        columnas: [
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 3 },
          { titulo: 'Visitas', campo: 'visitas', tipo: 'numero', ancho: 1 },
          { titulo: 'Consulta', campo: 'consulta', tipo: 'dinero', ancho: 1.3 },
          { titulo: 'Exámenes', campo: 'examenes', tipo: 'dinero', ancho: 1.3 },
          { titulo: 'Medicinas', campo: 'medicamentos', tipo: 'dinero', ancho: 1.3 },
          { titulo: 'Subtotal', campo: 'subtotal', tipo: 'dinero', ancho: 1.3 },
          { titulo: 'Descuento', campo: 'descuento', tipo: 'dinero', ancho: 1.3 },
          { titulo: 'Total', campo: 'total', tipo: 'dinero', ancho: 1.3 }
        ],
        filas: visitas,
        totales: tv,
        vacio: 'No hay visitas registradas con estos filtros.'
      },
      {
        titulo: 'Medicinas fuera de visita (médico general y cajón, sin descuento)',
        columnas: [
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 3 },
          { titulo: 'Despachos', campo: 'despachos', tipo: 'numero', ancho: 1 },
          { titulo: 'Costo', campo: 'bruto', tipo: 'dinero', ancho: 1.3 }
        ],
        filas: fuera,
        totales: tf,
        vacio: 'No hay medicinas despachadas fuera de visita.'
      }
    ]
  };
}

// ---------- 2. Historial clínico de un interno ----------
async function historial(f) {
  const [[interno]] = await pool.query(
    `SELECT ${NOMBRE_INTERNO} AS nombre, i.dpi, i.estado_salud, i.estado,
            DATE_FORMAT(i.fecha_nacimiento, '%d/%m/%Y') AS nacimiento, TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad,
            DATE_FORMAT(i.fecha_ingreso, '%d/%m/%Y') AS ingreso, fr.nombre_completo AS familiar
       FROM tbl_internos i LEFT JOIN tbl_familiares_responsables fr ON fr.id_familiar = i.id_familiar
      WHERE i.id_interno = ?`,
    [f.idInterno]
  );
  if (!interno) return null;

  const vp = [f.idInterno];
  const [padecimientos] = await pool.query(
    `SELECT DATE_FORMAT(p.fecha_registro, '%d/%m/%Y') AS fecha, p.nombre_padecimiento AS padecimiento, p.descripcion,
            CONCAT_WS(' · ', NULLIF(p.medicamento_cajon, ''), NULLIF(p.dosis, '')) AS tratamiento
       FROM tbl_psicopatologias p WHERE p.id_interno = ? AND p.anulada = 0 ORDER BY p.fecha_registro`,
    vp
  );

  const vc = [f.idInterno];
  const [consultas] = await pool.query(
    `SELECT DATE_FORMAT(c.fecha, '%d/%m/%Y') AS fecha, c.motivo, c.diagnostico, c.indicaciones, ${NOMBRE_USUARIO('u')} AS medico
       FROM tbl_consultas_generales c JOIN tbl_usuarios u ON u.id_usuario = c.id_medico
      WHERE c.id_interno = ? AND c.anulada = 0${filtroFecha('c.fecha', f, vc)}
      ORDER BY c.fecha`,
    vc
  );

  const vv = [f.idInterno];
  const [visitas] = await pool.query(
    `SELECT DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha, COALESCE(e.nombre, '') AS especialidad, ${NOMBRE_USUARIO('u')} AS especialista,
            v.diagnostico, v.observaciones, IF(v.cerrada = 1, 'CERRADA', 'EN CURSO') AS estado
       FROM tbl_visitas_medicas v
       JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
       LEFT JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
      WHERE v.id_interno = ? AND v.estado = 'Registrada'${filtroFecha('v.fecha_visita', f, vv)}
      ORDER BY v.fecha_visita`,
    vv
  );

  const ve = [f.idInterno];
  const [examenes] = await pool.query(
    `SELECT DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha, x.nombre_examen AS examen, x.estado,
            x.resultado, DATE_FORMAT(x.fecha_resultado, '%d/%m/%Y') AS fecha_resultado
       FROM tbl_examenes_laboratorio x JOIN tbl_visitas_medicas v ON v.id_visita = x.id_visita
      WHERE v.id_interno = ? AND x.estado <> 'Anulado'${filtroFecha('v.fecha_visita', f, ve)}
      ORDER BY v.fecha_visita, x.id_examen`,
    ve
  );

  // Recetas del especialista y del médico general, juntas y en orden de fecha
  const vr = [f.idInterno];
  const fr1 = filtroFecha('v.fecha_visita', f, vr);
  vr.push(f.idInterno);
  const fr2 = filtroFecha('c.fecha', f, vr);
  const [recetas] = await pool.query(
    `SELECT * FROM (
       SELECT v.fecha_visita AS orden, DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha, 'ESPECIALISTA' AS origen,
              r.medicamento, r.cantidad, CONCAT_WS(' · ', NULLIF(r.tiempo_aplicacion, ''), NULLIF(r.area_aplicacion, '')) AS indicaciones
         FROM tbl_recetas_visita r JOIN tbl_visitas_medicas v ON v.id_visita = r.id_visita
        WHERE v.id_interno = ? AND v.estado = 'Registrada'${fr1}
       UNION ALL
       SELECT c.fecha, DATE_FORMAT(c.fecha, '%d/%m/%Y'), 'MÉDICO GENERAL',
              CONCAT_WS(' ', m.nombre, m.presentacion), rc.cantidad, rc.indicaciones
         FROM tbl_recetas_consulta rc
         JOIN tbl_consultas_generales c ON c.id_consulta = rc.id_consulta
         JOIN tbl_medicamentos m ON m.id_medicamento = rc.id_medicamento
        WHERE c.id_interno = ? AND c.anulada = 0${fr2}
     ) x ORDER BY x.orden`,
    vr
  );

  return {
    resumen: [
      { etiqueta: 'Interno', valor: interno.nombre, tipo: 'texto' },
      { etiqueta: 'Edad', valor: interno.edad !== null ? `${interno.edad} AÑOS` : '—', tipo: 'texto' },
      { etiqueta: 'Ingreso', valor: interno.ingreso || '—', tipo: 'texto' },
      { etiqueta: 'Estado de salud', valor: interno.estado_salud || '—', tipo: 'texto' },
      { etiqueta: 'Responsable', valor: interno.familiar || '—', tipo: 'texto' }
    ],
    secciones: [
      {
        titulo: 'Padecimientos registrados',
        columnas: [
          { titulo: 'Desde', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Padecimiento', campo: 'padecimiento', tipo: 'texto', ancho: 2 },
          { titulo: 'Descripción', campo: 'descripcion', tipo: 'texto', ancho: 3 },
          { titulo: 'Tratamiento de cajón', campo: 'tratamiento', tipo: 'texto', ancho: 2 }
        ],
        filas: padecimientos, vacio: 'Sin padecimientos registrados.'
      },
      {
        titulo: 'Consultas con el médico general',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Motivo', campo: 'motivo', tipo: 'texto', ancho: 2 },
          { titulo: 'Diagnóstico', campo: 'diagnostico', tipo: 'texto', ancho: 2 },
          { titulo: 'Indicaciones', campo: 'indicaciones', tipo: 'texto', ancho: 2 },
          { titulo: 'Médico', campo: 'medico', tipo: 'texto', ancho: 1.5 }
        ],
        filas: consultas, vacio: 'Sin consultas en este período.'
      },
      {
        titulo: 'Visitas con especialistas',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Especialidad', campo: 'especialidad', tipo: 'texto', ancho: 1.5 },
          { titulo: 'Especialista', campo: 'especialista', tipo: 'texto', ancho: 1.5 },
          { titulo: 'Diagnóstico', campo: 'diagnostico', tipo: 'texto', ancho: 2.5 },
          { titulo: 'Observaciones', campo: 'observaciones', tipo: 'texto', ancho: 2 },
          { titulo: 'Estado', campo: 'estado', tipo: 'texto', ancho: 1 }
        ],
        filas: visitas, vacio: 'Sin visitas en este período.'
      },
      {
        titulo: 'Exámenes de laboratorio',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Examen', campo: 'examen', tipo: 'texto', ancho: 2 },
          { titulo: 'Estado', campo: 'estado', tipo: 'texto', ancho: 1.2 },
          { titulo: 'Resultado', campo: 'resultado', tipo: 'texto', ancho: 4 },
          { titulo: 'Fecha resultado', campo: 'fecha_resultado', tipo: 'texto', ancho: 1.2 }
        ],
        filas: examenes, vacio: 'Sin exámenes en este período.'
      },
      {
        titulo: 'Medicamentos recetados',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Recetó', campo: 'origen', tipo: 'texto', ancho: 1.3 },
          { titulo: 'Medicamento', campo: 'medicamento', tipo: 'texto', ancho: 2.5 },
          { titulo: 'Cantidad', campo: 'cantidad', tipo: 'numero', ancho: 0.8 },
          { titulo: 'Indicaciones', campo: 'indicaciones', tipo: 'texto', ancho: 3 }
        ],
        filas: recetas, vacio: 'Sin recetas en este período.'
      }
    ]
  };
}

// ---------- 3. Cobros por paciente ----------
// Cargos hechos en el rango (cuota del mes, visita o medicinas facturadas) y los pagos recibidos en el rango
async function cobros(f) {
  const vc = [];
  const fc1 = filtroFecha('c.mes', f, vc) + filtroInterno('c.id_interno', f, vc);
  const fc2 = filtroFecha('v.fecha_facturacion', f, vc) + filtroInterno('v.id_interno', f, vc);
  const fc3 = filtroFecha('d.fecha_facturacion', f, vc) + filtroInterno('d.id_interno', f, vc);
  const [cargos] = await pool.query(
    `SELECT x.*, DATE_FORMAT(x.orden, '%d/%m/%Y') AS fecha, x.monto - x.pagado AS saldo FROM (
       SELECT c.mes AS orden, ${NOMBRE_INTERNO} AS interno, fr.nombre_completo AS familiar,
              CONCAT('CUOTA ', DATE_FORMAT(c.mes, '%m/%Y')) AS concepto, c.monto, c.monto_pagado AS pagado, c.estado
         FROM tbl_cuotas_mensuales c
         JOIN tbl_internos i ON i.id_interno = c.id_interno
         JOIN tbl_familiares_responsables fr ON fr.id_familiar = c.id_familiar
        WHERE 1 = 1${fc1}
       UNION ALL
       SELECT v.fecha_facturacion, ${NOMBRE_INTERNO}, fr.nombre_completo, CONCAT('VISITA MÉDICA #', v.id_visita),
              v.monto_facturado, v.monto_pagado, v.estado_cobro
         FROM tbl_visitas_medicas v
         JOIN tbl_internos i ON i.id_interno = v.id_interno
         JOIN tbl_familiares_responsables fr ON fr.id_familiar = v.id_familiar_cobro
        WHERE v.estado_cobro <> 'Sin facturar'${fc2}
       UNION ALL
       SELECT d.fecha_facturacion, ${NOMBRE_INTERNO}, fr.nombre_completo, CONCAT('MEDICAMENTOS · DESPACHO #', d.id_despacho),
              d.monto_facturado, d.monto_pagado, d.estado_cobro
         FROM tbl_despachos d
         JOIN tbl_internos i ON i.id_interno = d.id_interno
         JOIN tbl_familiares_responsables fr ON fr.id_familiar = d.id_familiar_cobro
        WHERE d.estado_cobro <> 'Sin facturar'${fc3}
     ) x ORDER BY x.interno, x.orden`,
    vc
  );

  const vp = [];
  const fp = filtroFecha('p.fecha', f, vp)
    + (f.idInterno ? ' AND COALESCE(c.id_interno, v.id_interno, d.id_interno) = ?' : '');
  if (f.idInterno) vp.push(f.idInterno);
  const [pagos] = await pool.query(
    `SELECT DATE_FORMAT(p.fecha, '%d/%m/%Y') AS fecha, fr.nombre_completo AS familiar, ${NOMBRE_INTERNO} AS interno,
            IF(p.id_cuota IS NOT NULL, CONCAT('CUOTA ', DATE_FORMAT(c.mes, '%m/%Y')),
               IF(p.id_visita IS NOT NULL, CONCAT('VISITA MÉDICA #', p.id_visita), CONCAT('MEDICAMENTOS #', p.id_despacho))) AS concepto,
            CONCAT_WS(' · ', p.forma_pago, NULLIF(p.referencia, '')) AS forma, p.monto
       FROM tbl_pagos p
       JOIN tbl_familiares_responsables fr ON fr.id_familiar = p.id_familiar
       LEFT JOIN tbl_cuotas_mensuales c ON c.id_cuota = p.id_cuota
       LEFT JOIN tbl_visitas_medicas v ON v.id_visita = p.id_visita
       LEFT JOIN tbl_despachos d ON d.id_despacho = p.id_despacho
       JOIN tbl_internos i ON i.id_interno = COALESCE(c.id_interno, v.id_interno, d.id_interno)
      WHERE p.anulado = 0${fp}
      ORDER BY p.fecha`,
    vp
  );

  const tc = totalesDe(cargos, ['monto', 'pagado', 'saldo']);
  const tp = totalesDe(pagos, ['monto']);

  return {
    resumen: [
      { etiqueta: 'Cargado en el período', valor: tc.monto, tipo: 'dinero' },
      { etiqueta: 'Abonado a esos cargos', valor: tc.pagado, tipo: 'dinero' },
      { etiqueta: 'Saldo pendiente de esos cargos', valor: tc.saldo, tipo: 'dinero' },
      { etiqueta: 'Pagos recibidos en el período', valor: tp.monto, tipo: 'dinero' }
    ],
    secciones: [
      {
        titulo: 'Cargos a familiares',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Responsable', campo: 'familiar', tipo: 'texto', ancho: 2 },
          { titulo: 'Concepto', campo: 'concepto', tipo: 'texto', ancho: 2 },
          { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Pagado', campo: 'pagado', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Saldo', campo: 'saldo', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Estado', campo: 'estado', tipo: 'texto', ancho: 1.4 }
        ],
        filas: cargos, totales: tc, vacio: 'No hay cargos en este período.'
      },
      {
        titulo: 'Pagos recibidos',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Responsable', campo: 'familiar', tipo: 'texto', ancho: 2 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Concepto', campo: 'concepto', tipo: 'texto', ancho: 2 },
          { titulo: 'Forma de pago', campo: 'forma', tipo: 'texto', ancho: 1.6 },
          { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.1 }
        ],
        filas: pagos, totales: tp, vacio: 'No hay pagos en este período.'
      }
    ]
  };
}

// ---------- 4. Pagos a la Fundación ----------
async function fundacion(f) {
  const vp = [];
  const [pagos] = await pool.query(
    `SELECT DATE_FORMAT(pf.fecha, '%d/%m/%Y') AS fecha, pf.forma_pago AS forma, pf.referencia, pf.observacion,
            ${NOMBRE_USUARIO('u')} AS registro, pf.monto
       FROM tbl_pagos_fundacion pf JOIN tbl_usuarios u ON u.id_usuario = pf.id_usuario
      WHERE pf.anulado = 0${filtroFecha('pf.fecha', f, vp)}
      ORDER BY pf.fecha`,
    vp
  );

  // Lo que la Fundación facturó en el mismo período (visitas y medicinas con su descuento ya aplicado)
  const vf = [];
  const ff1 = filtroFecha('fecha_facturacion', f, vf);
  const ff2 = filtroFecha('fecha_facturacion', f, vf);
  const [[fact]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_visitas_medicas WHERE estado_cobro <> 'Sin facturar'${ff1}) AS visitas,
            (SELECT COALESCE(SUM(monto_facturado), 0) FROM tbl_despachos WHERE estado_cobro <> 'Sin facturar'${ff2}) AS medicinas`,
    vf
  );

  const deuda = await cajaModelo.deudaFundacion();
  const tp = totalesDe(pagos, ['monto']);

  return {
    resumen: [
      { etiqueta: 'Facturado en el período (visitas)', valor: num(fact.visitas), tipo: 'dinero' },
      { etiqueta: 'Facturado en el período (medicinas)', valor: num(fact.medicinas), tipo: 'dinero' },
      { etiqueta: 'Pagado en el período', valor: tp.monto, tipo: 'dinero' },
      { etiqueta: 'Deuda total a la fecha', valor: deuda.deuda, tipo: 'dinero' }
    ],
    secciones: [{
      titulo: 'Pagos efectuados a la Fundación',
      columnas: [
        { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
        { titulo: 'Forma de pago', campo: 'forma', tipo: 'texto', ancho: 1.3 },
        { titulo: 'Referencia', campo: 'referencia', tipo: 'texto', ancho: 1.3 },
        { titulo: 'Observación', campo: 'observacion', tipo: 'texto', ancho: 3 },
        { titulo: 'Registró', campo: 'registro', tipo: 'texto', ancho: 1.6 },
        { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.2 }
      ],
      filas: pagos, totales: tp, vacio: 'No hay pagos a la Fundación en este período.'
    }]
  };
}

// ---------- 5. Donaciones ----------
async function donaciones(f) {
  const v1 = [];
  const [porProcedencia] = await pool.query(
    `SELECT procedencia, COUNT(*) AS cantidad, SUM(monto) AS monto
       FROM tbl_donaciones WHERE anulado = 0${filtroFecha('fecha', f, v1)}
      GROUP BY procedencia ORDER BY monto DESC`,
    v1
  );
  const v2 = [];
  const [detalle] = await pool.query(
    `SELECT DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha, procedencia, donante, descripcion, monto
       FROM tbl_donaciones WHERE anulado = 0${filtroFecha('fecha', f, v2)}
      ORDER BY fecha, id_donacion`,
    v2
  );
  const t1 = totalesDe(porProcedencia, ['cantidad', 'monto']);

  return {
    resumen: [
      { etiqueta: 'Donaciones recibidas', valor: t1.cantidad, tipo: 'numero' },
      { etiqueta: 'Total donado', valor: t1.monto, tipo: 'dinero' }
    ],
    secciones: [
      {
        titulo: 'Por procedencia',
        columnas: [
          { titulo: 'Procedencia', campo: 'procedencia', tipo: 'texto', ancho: 3 },
          { titulo: 'Cantidad', campo: 'cantidad', tipo: 'numero', ancho: 1 },
          { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.5 }
        ],
        filas: porProcedencia, totales: t1, vacio: 'No hay donaciones en este período.'
      },
      {
        titulo: 'Detalle de donaciones',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Procedencia', campo: 'procedencia', tipo: 'texto', ancho: 1.5 },
          { titulo: 'Donante', campo: 'donante', tipo: 'texto', ancho: 2.5 },
          { titulo: 'Descripción', campo: 'descripcion', tipo: 'texto', ancho: 3 },
          { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.2 }
        ],
        filas: detalle, totales: totalesDe(detalle, ['monto']), vacio: 'No hay donaciones en este período.'
      }
    ]
  };
}

// ---------- 6. Cuotas mensuales ----------
// Lo que se cobró de cuotas (pagos recibidos en el rango) y cómo están las cuotas de los meses del rango
async function cuotas(f) {
  const vp = [];
  const [recibidas] = await pool.query(
    `SELECT DATE_FORMAT(p.fecha, '%d/%m/%Y') AS fecha, ${NOMBRE_INTERNO} AS interno, fr.nombre_completo AS familiar,
            DATE_FORMAT(c.mes, '%m/%Y') AS mes, CONCAT_WS(' · ', p.forma_pago, NULLIF(p.referencia, '')) AS forma, p.monto
       FROM tbl_pagos p
       JOIN tbl_cuotas_mensuales c ON c.id_cuota = p.id_cuota
       JOIN tbl_internos i ON i.id_interno = c.id_interno
       JOIN tbl_familiares_responsables fr ON fr.id_familiar = p.id_familiar
      WHERE p.anulado = 0${filtroFecha('p.fecha', f, vp)}${filtroInterno('c.id_interno', f, vp)}
      ORDER BY p.fecha`,
    vp
  );

  // Una cuota "cae" en el rango si su mes se cruza con él
  const ve = [];
  let fe = '';
  if (f.desde && f.hasta) {
    fe = ` AND c.mes BETWEEN DATE_FORMAT(?, '%Y-%m-01') AND ?`;
    ve.push(f.desde, f.hasta);
  }
  fe += filtroInterno('c.id_interno', f, ve);
  const [estado] = await pool.query(
    `SELECT DATE_FORMAT(c.mes, '%m/%Y') AS mes, ${NOMBRE_INTERNO} AS interno, fr.nombre_completo AS familiar,
            c.monto, c.monto_pagado AS pagado, c.monto - c.monto_pagado AS saldo, c.estado
       FROM tbl_cuotas_mensuales c
       JOIN tbl_internos i ON i.id_interno = c.id_interno
       JOIN tbl_familiares_responsables fr ON fr.id_familiar = c.id_familiar
      WHERE 1 = 1${fe}
      ORDER BY c.mes, interno`,
    ve
  );

  const tr = totalesDe(recibidas, ['monto']);
  const te = totalesDe(estado, ['monto', 'pagado', 'saldo']);

  return {
    resumen: [
      { etiqueta: 'Cuotas cobradas en el período', valor: tr.monto, tipo: 'dinero' },
      { etiqueta: 'Cuotas generadas de esos meses', valor: te.monto, tipo: 'dinero' },
      { etiqueta: 'Pendiente de esas cuotas', valor: te.saldo, tipo: 'dinero' }
    ],
    secciones: [
      {
        titulo: 'Pagos de cuotas recibidos',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Responsable', campo: 'familiar', tipo: 'texto', ancho: 2 },
          { titulo: 'Mes', campo: 'mes', tipo: 'texto', ancho: 0.9 },
          { titulo: 'Forma de pago', campo: 'forma', tipo: 'texto', ancho: 1.6 },
          { titulo: 'Monto', campo: 'monto', tipo: 'dinero', ancho: 1.1 }
        ],
        filas: recibidas, totales: tr, vacio: 'No se recibieron pagos de cuotas en este período.'
      },
      {
        titulo: 'Estado de las cuotas de esos meses',
        columnas: [
          { titulo: 'Mes', campo: 'mes', tipo: 'texto', ancho: 0.9 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Responsable', campo: 'familiar', tipo: 'texto', ancho: 2 },
          { titulo: 'Cuota', campo: 'monto', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Pagado', campo: 'pagado', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Saldo', campo: 'saldo', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Estado', campo: 'estado', tipo: 'texto', ancho: 1.4 }
        ],
        filas: estado, totales: te, vacio: 'No hay cuotas generadas para esos meses.'
      }
    ]
  };
}

// ---------- 7. Exámenes y medicamentos aplicados por paciente ----------
async function aplicados(f) {
  const ve = [];
  const [examenes] = await pool.query(
    `SELECT DATE_FORMAT(v.fecha_visita, '%d/%m/%Y') AS fecha, ${NOMBRE_INTERNO} AS interno, x.nombre_examen AS examen,
            x.estado, x.costo_estimado AS estimado, x.costo_real AS costo_real,
            DATE_FORMAT(x.fecha_resultado, '%d/%m/%Y') AS fecha_resultado
       FROM tbl_examenes_laboratorio x
       JOIN tbl_visitas_medicas v ON v.id_visita = x.id_visita
       JOIN tbl_internos i ON i.id_interno = v.id_interno
      WHERE x.estado <> 'Anulado'${filtroFecha('v.fecha_visita', f, ve)}${filtroInterno('v.id_interno', f, ve)}
      ORDER BY interno, v.fecha_visita, x.id_examen`,
    ve
  );

  const vm = [];
  const [medicinas] = await pool.query(
    `SELECT DATE_FORMAT(d.fecha, '%d/%m/%Y') AS fecha, ${NOMBRE_INTERNO} AS interno,
            CONCAT_WS(' ', m.nombre, m.presentacion) AS medicamento,
            CASE WHEN dd.id_receta IS NOT NULL THEN 'ESPECIALISTA'
                 WHEN dd.id_receta_consulta IS NOT NULL THEN 'MÉDICO GENERAL'
                 ELSE 'CAJÓN' END AS origen,
            dd.cantidad, dd.precio_unitario AS precio, dd.subtotal
       FROM tbl_medicamentos_despachados dd
       JOIN tbl_despachos d ON d.id_despacho = dd.id_despacho
       JOIN tbl_internos i ON i.id_interno = d.id_interno
       JOIN tbl_medicamentos m ON m.id_medicamento = dd.id_medicamento
      WHERE 1 = 1${filtroFecha('d.fecha', f, vm)}${filtroInterno('d.id_interno', f, vm)}
      ORDER BY interno, d.fecha, dd.id_detalle`,
    vm
  );

  const te = totalesDe(examenes, ['estimado', 'costo_real']);
  const tm = totalesDe(medicinas, ['cantidad', 'subtotal']);

  return {
    resumen: [
      { etiqueta: 'Exámenes', valor: examenes.length, tipo: 'numero' },
      { etiqueta: 'Con resultado', valor: examenes.filter((x) => x.estado === 'Con resultado').length, tipo: 'numero' },
      { etiqueta: 'Unidades de medicina aplicadas', valor: tm.cantidad, tipo: 'numero' },
      { etiqueta: 'Costo de medicinas (sin descuento)', valor: tm.subtotal, tipo: 'dinero' }
    ],
    secciones: [
      {
        titulo: 'Exámenes de laboratorio',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Examen', campo: 'examen', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Estado', campo: 'estado', tipo: 'texto', ancho: 1.2 },
          { titulo: 'Costo aprox.', campo: 'estimado', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Costo real', campo: 'costo_real', tipo: 'dinero', ancho: 1.1 },
          { titulo: 'Resultado', campo: 'fecha_resultado', tipo: 'texto', ancho: 1 }
        ],
        filas: examenes, totales: te, vacio: 'No hay exámenes en este período.'
      },
      {
        titulo: 'Medicamentos despachados',
        columnas: [
          { titulo: 'Fecha', campo: 'fecha', tipo: 'texto', ancho: 1 },
          { titulo: 'Interno', campo: 'interno', tipo: 'texto', ancho: 2.2 },
          { titulo: 'Medicamento', campo: 'medicamento', tipo: 'texto', ancho: 2.4 },
          { titulo: 'Recetó', campo: 'origen', tipo: 'texto', ancho: 1.3 },
          { titulo: 'Cant.', campo: 'cantidad', tipo: 'numero', ancho: 0.7 },
          { titulo: 'Precio', campo: 'precio', tipo: 'dinero', ancho: 1 },
          { titulo: 'Subtotal', campo: 'subtotal', tipo: 'dinero', ancho: 1.1 }
        ],
        filas: medicinas, totales: tm, vacio: 'No se despacharon medicamentos en este período.'
      }
    ]
  };
}

// ---------- Catálogo ----------
// filtros.interno: 'requerido' | 'opcional' | null
// rangoInicial: 'mes' (el mes actual) | 'todo' (sin fechas: todo el historial)
const CATALOGO = [
  { clave: 'costos', titulo: 'Costos por paciente', descripcion: 'Consultas, exámenes y medicinas de cada interno, con el descuento de la Fundación.', interno: 'opcional', rangoInicial: 'mes', generar: costos },
  { clave: 'historial', titulo: 'Historial clínico por interno', descripcion: 'Padecimientos, consultas, visitas, exámenes y recetas de un interno.', interno: 'requerido', rangoInicial: 'todo', generar: historial },
  { clave: 'cobros', titulo: 'Cobros por paciente', descripcion: 'Lo que se cargó a cada familiar, lo pagado y lo pendiente en un rango de fechas.', interno: 'opcional', rangoInicial: 'mes', generar: cobros },
  { clave: 'fundacion', titulo: 'Pagos a la Fundación', descripcion: 'Pagos efectuados a la Fundación, lo facturado y la deuda actual.', interno: null, rangoInicial: 'mes', generar: fundacion },
  { clave: 'donaciones', titulo: 'Donaciones', descripcion: 'Entradas por donaciones de empresas, gobierno y personas.', interno: null, rangoInicial: 'mes', generar: donaciones },
  { clave: 'cuotas', titulo: 'Cuotas mensuales', descripcion: 'Cuotas cobradas y estado de las cuotas de cada mes.', interno: 'opcional', rangoInicial: 'mes', generar: cuotas },
  { clave: 'aplicados', titulo: 'Exámenes y medicamentos aplicados', descripcion: 'Detalle por paciente de cada examen y cada medicamento despachado.', interno: 'opcional', rangoInicial: 'mes', generar: aplicados }
];

const buscar = (clave) => CATALOGO.find((r) => r.clave === clave) || null;

// Nombre del interno elegido en el filtro (para mostrarlo en el buscador y en el encabezado)
async function nombreInterno(id) {
  const [[i]] = await pool.query(`SELECT ${NOMBRE_INTERNO} AS nombre FROM tbl_internos i WHERE i.id_interno = ?`, [id]);
  return i ? i.nombre : null;
}

module.exports = { CATALOGO, buscar, nombreInterno };
