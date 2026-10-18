const cobroModelo = require('../modelos/cobroModelo');
const cajaModelo = require('../modelos/cajaModelo');
const calculadorCostos = require('../servicios/calculadorCostos');
const { mayus } = require('../utilidades/texto');
const { leerImporte, hoy, leerFecha, leerMes, mesActual } = require('../utilidades/dinero');

const MENSAJES = new Map([
  ['pago',          { tipo: 'success', texto: 'Pago registrado.' }],
  ['pago_anulado',  { tipo: 'success', texto: 'Pago anulado: lo pagado vuelve a deberse.' }],
  ['facturada',     { tipo: 'success', texto: 'Facturado: el cargo ya está en la cuenta del familiar.' }],
  ['facturadas',    { tipo: 'success', texto: 'Se facturó todo lo pendiente.' }],
  ['no_facturable', { tipo: 'danger',  texto: 'Eso ya no se puede facturar (ya se facturó o cambió su estado).' }],
  ['costos_caido',  { tipo: 'warning', texto: 'El microservicio de costos no respondió: no se pudo aplicar el 20% a los medicamentos. Intenta más tarde.' }],
  ['donacion',      { tipo: 'success', texto: 'Donación registrada.' }],
  ['gasto',         { tipo: 'success', texto: 'Gasto registrado.' }],
  ['pago_fundacion',{ tipo: 'success', texto: 'Pago a la Fundación registrado.' }],
  ['anulado',       { tipo: 'success', texto: 'Registro anulado: se conserva, pero ya no cuenta en la caja.' }],
  ['ya_anulado',    { tipo: 'danger',  texto: 'Ese registro ya estaba anulado.' }],
  ['motivo_corto',  { tipo: 'danger',  texto: 'Explica por qué se anula (entre 10 y 255 caracteres).' }],
  ['no_existe',     { tipo: 'danger',  texto: 'El registro no existe.' }]
]);

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });

function aviso(req) {
  const a = MENSAJES.get(req.query.msg);
  return { mensaje: a ? a.texto : null, tipo: a ? a.tipo : null };
}

// Rango de fechas de los filtros (por defecto, el mes actual)
function rango(query) {
  const mes = mesActual();
  let desde = leerFecha(query.desde) || mes.desde;
  let hasta = leerFecha(query.hasta) || mes.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}

function motivoValido(valor) {
  const m = mayus(valor);
  return m.length >= 10 && m.length <= 255 ? m : null;
}

// ===================== CUENTAS DE FAMILIARES =====================

exports.cuentas = async (req, res) => {
  try {
    const busqueda = String(req.query.q || '').trim().slice(0, 100);
    const lista = await cobroModelo.cuentas(busqueda);
    const total = lista.reduce((s, f) => s + Number(f.saldo_pendiente), 0);

    res.render('finanzas/cuentas', {
      ...base(req, 'Cuentas de familiares'),
      lista, busqueda, totalPorCobrar: total.toFixed(2), ...aviso(req)
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las cuentas');
  }
};

async function pintarEstadoCuenta(req, res, familiar, mensaje, tipo) {
  const { cargos, pagos } = await cobroModelo.estadoCuenta(familiar.id_familiar);
  res.render('finanzas/estado-cuenta', {
    ...base(req, `Cuenta de ${familiar.nombre_completo}`),
    familiar,
    cargos: cargos.map((c) => ({ ...c, saldo: Number(c.saldo).toFixed(2), pendiente: c.estado === 'Pendiente de Pago' })),
    pagos,
    formas: cajaModelo.FORMAS_PAGO,
    mensaje, tipo
  });
}

exports.estadoCuenta = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const familiar = Number.isNaN(id) ? null : await cobroModelo.buscarFamiliar(id);
    if (!familiar) return res.redirect('/finanzas/cuentas?msg=no_existe');

    const a = aviso(req);
    await pintarEstadoCuenta(req, res, familiar, a.mensaje, a.tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el estado de cuenta');
  }
};

exports.registrarPago = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const familiar = Number.isNaN(id) ? null : await cobroModelo.buscarFamiliar(id);
    if (!familiar) return res.redirect('/finanzas/cuentas?msg=no_existe');

    const monto = leerImporte(req.body.monto);
    const formaPago = cajaModelo.FORMAS_PAGO.includes(req.body.forma_pago) ? req.body.forma_pago : null;
    const referencia = mayus(req.body.referencia).slice(0, 60);
    const idCargo = parseInt(req.body.id_cargo, 10);

    if (monto === null) return pintarEstadoCuenta(req, res, familiar, 'Escribe un monto válido mayor que 0 (ejemplo: 150 o 150.50).', 'danger');
    if (!formaPago) return pintarEstadoCuenta(req, res, familiar, 'Elige la forma de pago.', 'danger');
    if (formaPago !== 'Efectivo' && !referencia) {
      return pintarEstadoCuenta(req, res, familiar, 'Para transferencia, depósito o cheque escribe el número de referencia.', 'danger');
    }

    try {
      await cobroModelo.registrarPago({
        idFamiliar: id, tipo: req.body.tipo, idCargo, monto, formaPago, referencia, idUsuario: req.session.idUsuario
      });
    } catch (error) {
      if (error.deNegocio) return pintarEstadoCuenta(req, res, familiar, error.message, 'danger');
      throw error;
    }

    res.redirect(`/finanzas/cuentas/${id}?msg=pago`);
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el pago');
  }
};

exports.anularPago = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const motivo = motivoValido(req.body.motivo);
    const volverA = parseInt(req.body.id_familiar, 10);
    const destino = Number.isNaN(volverA) ? '/finanzas/cuentas' : `/finanzas/cuentas/${volverA}`;

    if (Number.isNaN(id)) return res.redirect(`${destino}?msg=no_existe`);
    if (!motivo) return res.redirect(`${destino}?msg=motivo_corto`);

    const idFamiliar = await cobroModelo.anularPago(id, motivo);
    res.redirect(idFamiliar ? `/finanzas/cuentas/${idFamiliar}?msg=pago_anulado` : `${destino}?msg=ya_anulado`);
  } catch (error) {
    console.error(error);
    res.send('Error al anular el pago');
  }
};

// ===================== CUOTAS MENSUALES (RN14) =====================

exports.cuotas = async (req, res) => {
  try {
    const mesTexto = leerMes(req.query.mes) ? req.query.mes : mesActual().mes;
    const filas = await cobroModelo.internosParaCuotas(`${mesTexto}-01`);

    res.render('finanzas/cuotas', {
      ...base(req, 'Cuotas mensuales'),
      mes: mesTexto,
      filas: filas.map((f) => ({ ...f, generada: Boolean(f.id_cuota), propuesta: Number(f.cuota_mensual) > 0 ? f.cuota_mensual : '' })),
      pendientesDeGenerar: filas.filter((f) => !f.id_cuota).length,
      ...(req.avisoCuotas || aviso(req))
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las cuotas');
  }
};

exports.generarCuotas = async (req, res) => {
  try {
    const mes = leerMes(req.body.mes);
    if (!mes) return res.redirect('/finanzas/cuotas');
    const mesTexto = mes.slice(0, 7);

    const incluir = new Set((Array.isArray(req.body.incluir) ? req.body.incluir : [req.body.incluir]).filter(Boolean).map(Number));
    const montos = req.body.montos && typeof req.body.montos === 'object' ? req.body.montos : {};
    const items = [];
    const errores = [];

    for (const idInterno of incluir) {
      const monto = leerImporte(montos[idInterno]);
      if (monto === null) errores.push(idInterno);
      else items.push({ id_interno: idInterno, monto });
    }

    if (items.length === 0 || errores.length > 0) {
      req.session.avisoCuotas = errores.length > 0
        ? 'Cada interno marcado necesita un monto de cuota mayor que 0.'
        : 'Marca al menos un interno.';
      return res.redirect(`/finanzas/cuotas?mes=${mesTexto}&msg=cuotas_error`);
    }

    const { creadas, existentes } = await cobroModelo.generarCuotas(mes, items);
    req.session.avisoCuotas = `Se generaron ${creadas} cuota(s)${existentes ? `; ${existentes} ya existían y no se duplicaron` : ''}.`;
    res.redirect(`/finanzas/cuotas?mes=${mesTexto}&msg=cuotas_ok`);
  } catch (error) {
    console.error(error);
    res.send('Error al generar las cuotas');
  }
};

// El aviso de cuotas lleva números, así que viaja una sola vez en la sesión
exports.avisoCuotas = (req, res, next) => {
  // (se guarda en req, no en MENSAJES: MENSAJES es de todos los usuarios y se mezclarían los avisos)
  if (['cuotas_ok', 'cuotas_error'].includes(req.query.msg) && req.session.avisoCuotas) {
    req.avisoCuotas = { tipo: req.query.msg === 'cuotas_ok' ? 'success' : 'danger', mensaje: req.session.avisoCuotas };
  }
  delete req.session.avisoCuotas;
  next();
};

// ===================== FACTURACIÓN (RN2, RN9) =====================

exports.facturacion = async (req, res) => {
  try {
    const [visitas, enEspera, despachos] = await Promise.all([
      cobroModelo.visitasPorFacturar(),
      cobroModelo.visitasEnEspera(),
      cobroModelo.despachosPorFacturar()
    ]);

    res.render('finanzas/facturacion', {
      ...base(req, 'Facturación'),
      visitas, enEspera, despachos,
      hayAlgo: visitas.length + despachos.length > 0,
      ...aviso(req)
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la facturación');
  }
};

exports.facturarVisita = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const bien = Number.isNaN(id) ? false : await cobroModelo.facturarVisita(id);
    res.redirect(`/finanzas/facturacion?msg=${bien ? 'facturada' : 'no_facturable'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al facturar la visita');
  }
};

// Medicamentos sin visita: el 20% lo aplica el microservicio de costos (RN1); si no responde, no se factura todavía
async function facturarUnDespacho(id) {
  const bruto = await cobroModelo.brutoDespacho(id);
  if (bruto <= 0) return 'no_facturable';

  let costos;
  try {
    costos = await calculadorCostos.calcular({ consulta: 0, examenes: 0, medicamentos: bruto });
  } catch (error) {
    return 'costos_caido';
  }

  return (await cobroModelo.facturarDespacho(id, costos)) ? 'facturada' : 'no_facturable';
}

exports.facturarDespacho = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const resultado = Number.isNaN(id) ? 'no_facturable' : await facturarUnDespacho(id);
    res.redirect(`/finanzas/facturacion?msg=${resultado}`);
  } catch (error) {
    console.error(error);
    res.send('Error al facturar el despacho');
  }
};

exports.facturarTodo = async (req, res) => {
  try {
    const [visitas, despachos] = await Promise.all([cobroModelo.visitasPorFacturar(), cobroModelo.despachosPorFacturar()]);

    for (const v of visitas) await cobroModelo.facturarVisita(v.id_visita);

    for (const d of despachos) {
      const r = await facturarUnDespacho(d.id_despacho);
      if (r === 'costos_caido') return res.redirect('/finanzas/facturacion?msg=costos_caido');
    }

    res.redirect('/finanzas/facturacion?msg=facturadas');
  } catch (error) {
    console.error(error);
    res.send('Error al facturar');
  }
};

// ===================== DONACIONES (RN15) =====================

async function pintarDonaciones(req, res, form, mensaje, tipo) {
  const r = rango(req.query);
  const [lista, resumen] = await Promise.all([cajaModelo.donaciones(r.desde, r.hasta), cajaModelo.donacionesPorProcedencia(r.desde, r.hasta)]);
  res.render('finanzas/donaciones', {
    ...base(req, 'Donaciones'),
    lista, resumen, ...r,
    total: resumen.reduce((s, x) => s + Number(x.total), 0).toFixed(2),
    procedencias: cajaModelo.PROCEDENCIAS,
    donacionForm: form,
    hoy: hoy(),
    mensaje, tipo
  });
}

exports.donaciones = async (req, res) => {
  try {
    const a = aviso(req);
    await pintarDonaciones(req, res, { fecha: hoy() }, a.mensaje, a.tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar las donaciones');
  }
};

exports.crearDonacion = async (req, res) => {
  try {
    const d = {
      procedencia: cajaModelo.PROCEDENCIAS.includes(req.body.procedencia) ? req.body.procedencia : null,
      donante: mayus(req.body.donante),
      monto: leerImporte(req.body.monto),
      fecha: leerFecha(req.body.fecha),
      descripcion: mayus(req.body.descripcion)
    };

    let error = null;
    if (!d.procedencia) error = 'Elige la procedencia de la donación.';
    else if (d.donante.length < 3 || d.donante.length > 150) error = 'Escribe el nombre del donante (empresa, institución o persona).';
    else if (d.monto === null) error = 'Escribe un monto válido mayor que 0.';
    else if (!d.fecha || d.fecha > hoy()) error = 'La fecha no es válida (no puede ser futura).';
    else if (d.descripcion.length > 255) error = 'La descripción admite máximo 255 caracteres.';

    if (error) return pintarDonaciones(req, res, req.body, error, 'danger');

    await cajaModelo.crearDonacion(d, req.session.idUsuario);
    res.redirect('/finanzas/donaciones?msg=donacion');
  } catch (error) {
    console.error(error);
    res.send('Error al registrar la donación');
  }
};

// ===================== CAJA Y GASTOS (RN15) =====================

async function pintarCaja(req, res, form, mensaje, tipo) {
  const r = rango(req.query);
  const [libro, gastos] = await Promise.all([cajaModelo.libroCaja(r.desde, r.hasta), cajaModelo.gastos(r.desde, r.hasta)]);
  res.render('finanzas/caja', {
    ...base(req, 'Caja'),
    libro, gastos, ...r,
    conceptos: cajaModelo.CONCEPTOS_GASTO,
    gastoForm: form,
    hoy: hoy(),
    mensaje, tipo
  });
}

exports.caja = async (req, res) => {
  try {
    const a = aviso(req);
    await pintarCaja(req, res, { fecha: hoy() }, a.mensaje, a.tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar la caja');
  }
};

exports.crearGasto = async (req, res) => {
  try {
    const g = {
      concepto: cajaModelo.CONCEPTOS_GASTO.includes(req.body.concepto) ? req.body.concepto : null,
      descripcion: mayus(req.body.descripcion),
      monto: leerImporte(req.body.monto),
      fecha: leerFecha(req.body.fecha)
    };

    let error = null;
    if (!g.concepto) error = 'Elige el concepto del gasto.';
    else if (g.concepto === 'Otro' && g.descripcion.length < 3) error = 'Para "Otro" describe en qué se gastó.';
    else if (g.descripcion.length > 255) error = 'La descripción admite máximo 255 caracteres.';
    else if (g.monto === null) error = 'Escribe un monto válido mayor que 0.';
    else if (!g.fecha || g.fecha > hoy()) error = 'La fecha no es válida (no puede ser futura).';

    if (error) return pintarCaja(req, res, req.body, error, 'danger');

    await cajaModelo.crearGasto(g, req.session.idUsuario);
    res.redirect('/finanzas/caja?msg=gasto');
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el gasto');
  }
};

// ===================== PAGOS A LA FUNDACIÓN (RQ7) =====================

async function pintarFundacion(req, res, form, mensaje, tipo) {
  const [deuda, pagos] = await Promise.all([cajaModelo.deudaFundacion(), cajaModelo.pagosFundacion()]);
  res.render('finanzas/fundacion', {
    ...base(req, 'Pagos a la Fundación'),
    deuda: {
      visitas: deuda.visitas.toFixed(2), medicamentos: deuda.medicamentos.toFixed(2),
      facturado: deuda.facturado.toFixed(2), pagado: deuda.pagado.toFixed(2), deuda: deuda.deuda.toFixed(2),
      hayDeuda: deuda.deuda > 0
    },
    pagos,
    formas: cajaModelo.FORMAS_PAGO,
    pagoForm: form,
    hoy: hoy(),
    mensaje, tipo
  });
}

exports.fundacion = async (req, res) => {
  try {
    const a = aviso(req);
    await pintarFundacion(req, res, { fecha: hoy() }, a.mensaje, a.tipo);
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los pagos a la Fundación');
  }
};

exports.crearPagoFundacion = async (req, res) => {
  try {
    const p = {
      monto: leerImporte(req.body.monto),
      fecha: leerFecha(req.body.fecha),
      forma_pago: cajaModelo.FORMAS_PAGO.includes(req.body.forma_pago) ? req.body.forma_pago : null,
      referencia: mayus(req.body.referencia).slice(0, 60),
      observacion: mayus(req.body.observacion).slice(0, 255)
    };

    let error = null;
    if (p.monto === null) error = 'Escribe un monto válido mayor que 0.';
    else if (!p.fecha || p.fecha > hoy()) error = 'La fecha no es válida (no puede ser futura).';
    else if (!p.forma_pago) error = 'Elige la forma de pago.';
    else if (p.forma_pago !== 'Efectivo' && !p.referencia) error = 'Para transferencia, depósito o cheque escribe el número de referencia.';

    if (error) return pintarFundacion(req, res, req.body, error, 'danger');

    const r = await cajaModelo.crearPagoFundacion(p, req.session.idUsuario);
    if (r.error) return pintarFundacion(req, res, req.body, r.error, 'danger');

    res.redirect('/finanzas/fundacion?msg=pago_fundacion');
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el pago a la Fundación');
  }
};

// ===================== ANULAR (donación, gasto, pago a la Fundación) =====================

exports.anular = (tipo, volverA) => async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const motivo = motivoValido(req.body.motivo);
    if (Number.isNaN(id)) return res.redirect(`${volverA}?msg=no_existe`);
    if (!motivo) return res.redirect(`${volverA}?msg=motivo_corto`);

    const cambio = await cajaModelo.anular(tipo, id, motivo);
    res.redirect(`${volverA}?msg=${cambio ? 'anulado' : 'ya_anulado'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al anular');
  }
};
