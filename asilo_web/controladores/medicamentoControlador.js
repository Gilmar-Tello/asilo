const medicamentoModelo = require('../modelos/medicamentoModelo');
const { texto, mayus } = require('../utilidades/texto');

const MAX_IMPORTE = 99999.99;
const DIAS_AVISO_VENCIMIENTO = 60;   // "por vencer" = vence en 60 días o menos

const MENSAJES = new Map([
  ['creado',     { tipo: 'success', texto: 'Medicamento agregado al catálogo.' }],
  ['editado',    { tipo: 'success', texto: 'Medicamento actualizado.' }],
  ['ingreso',    { tipo: 'success', texto: 'Lote ingresado. La existencia ya se actualizó.' }],
  ['baja',       { tipo: 'success', texto: 'Lote vencido dado de baja. Quedó registrado en los movimientos.' }],
  ['baja_no',    { tipo: 'danger',  texto: 'Ese lote no se puede dar de baja (solo lotes vencidos que aún tienen existencia).' }],
  ['estado',     { tipo: 'success', texto: 'Estado del medicamento actualizado.' }],
  ['no_existe',  { tipo: 'danger',  texto: 'El medicamento no existe.' }],
  ['desactivado',{ tipo: 'danger',  texto: 'No se puede ingresar existencia a un medicamento desactivado.' }]
]);

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });

// Precio en quetzales: "25" o "25,50". null si no es válido.
function leerImporte(valor) {
  const limpio = String(valor === undefined ? '' : valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero <= MAX_IMPORTE ? numero : null;
}

function leerEntero(valor, minimo, maximo) {
  const limpio = String(valor === undefined ? '' : valor).trim();
  if (!/^\d+$/.test(limpio)) return null;
  const numero = parseInt(limpio, 10);
  return numero >= minimo && numero <= maximo ? numero : null;
}

// Hoy como 'AAAA-MM-DD' (hora local del servidor)
function hoy() {
  const f = new Date();
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

// Fecha 'AAAA-MM-DD' que exista de verdad (rechaza 31 de febrero). Devuelve el texto o null.
function leerFecha(valor) {
  const t = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [a, m, d] = t.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? t : null;
}

// Datos del medicamento. Devuelve { datos, error }.
function leerMedicamento(body) {
  const datos = {
    nombre: mayus(body.nombre),
    presentacion: mayus(body.presentacion),
    precio: leerImporte(body.precio),
    existencia_minima: leerEntero(body.existencia_minima === undefined || body.existencia_minima === '' ? '10' : body.existencia_minima, 0, 99999)
  };

  let error = null;
  if (datos.nombre.length < 2 || datos.nombre.length > 100) error = 'El nombre debe tener entre 2 y 100 caracteres.';
  else if (datos.presentacion.length > 60) error = 'La presentación admite máximo 60 caracteres.';
  else if (datos.precio === null) error = 'Escribe el precio de venta en quetzales (ejemplo: 12 o 12.50).';
  else if (datos.existencia_minima === null) error = 'La existencia mínima debe ser un número entero entre 0 y 99999.';

  return { datos, error };
}

// Datos de un lote. Si 'opcional' y no trae cantidad, devuelve { lote: null } (crear sin existencia).
function leerLote(body, opcional) {
  const cantidadTexto = String(body.cantidad === undefined ? '' : body.cantidad).trim();

  if (opcional && (cantidadTexto === '' || cantidadTexto === '0')) {
    return { lote: null, error: null };
  }

  const lote = {
    cantidad: leerEntero(cantidadTexto, 1, 99999),
    numero_lote: mayus(body.numero_lote),
    fecha_vencimiento: leerFecha(body.fecha_vencimiento),
    precio_compra: leerImporte(body.precio_compra),
    proveedor: mayus(body.proveedor)
  };

  let error = null;
  if (lote.cantidad === null) error = 'La cantidad del lote debe ser un número entero entre 1 y 99999.';
  else if (lote.numero_lote.length > 40) error = 'El número de lote admite máximo 40 caracteres.';
  else if (!lote.fecha_vencimiento) error = 'Escribe la fecha de vencimiento del lote.';
  else if (lote.fecha_vencimiento <= hoy()) error = 'No se puede ingresar un lote vencido o que vence hoy.';
  else if (lote.precio_compra === null) error = 'Escribe el precio de compra por unidad (ejemplo: 8 o 8.75).';
  else if (lote.proveedor.length > 100) error = 'El proveedor admite máximo 100 caracteres.';

  return { lote, error };
}

exports.listar = async (req, res) => {
  try {
    const busqueda = texto(req.query.q).slice(0, 100);
    const lista = await medicamentoModelo.listar(busqueda);
    const aviso = MENSAJES.get(req.query.msg);

    res.render('medicamentos/listar', {
      ...base(req, 'Medicamentos'),
      lista: lista.map((m) => ({
        ...m,
        agotado: Number(m.disponible) === 0,
        poco: Number(m.disponible) > 0 && Number(m.disponible) <= m.existencia_minima,
        hayVencido: Number(m.vencida) > 0,
        porVencer: m.dias_para_vencer !== null && m.dias_para_vencer <= DIAS_AVISO_VENCIMIENTO
      })),
      busqueda,
      mensaje: aviso ? aviso.texto : null,
      tipo: aviso ? aviso.tipo : null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los medicamentos');
  }
};

exports.mostrarCrear = (req, res) => {
  res.render('medicamentos/formulario', {
    ...base(req, 'Nuevo medicamento'),
    esNuevo: true,
    medicamentoForm: { existencia_minima: 10 },
    loteForm: {},
    manana: manana(),
    lotes: [],
    movimientos: [],
    mensaje: null
  });
};

// Mañana como 'AAAA-MM-DD' (mínimo para la fecha de vencimiento en el formulario)
function manana() {
  const f = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

exports.crear = async (req, res) => {
  const { datos, error } = leerMedicamento(req.body);
  const { lote, error: errorLote } = leerLote(req.body, true);

  const volver = (mensaje) => res.render('medicamentos/formulario', {
    ...base(req, 'Nuevo medicamento'),
    esNuevo: true,
    medicamentoForm: { ...req.body, nombre: datos.nombre, presentacion: datos.presentacion },
    loteForm: req.body,
    manana: manana(),
    lotes: [],
    movimientos: [],
    mensaje
  });

  if (error || errorLote) return volver(error || errorLote);

  try {
    await medicamentoModelo.crear(datos, lote, req.session.idUsuario);
    res.redirect('/medicamentos?msg=creado');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return volver('Ya existe un medicamento con ese nombre y presentación.');
    }
    console.error(err);
    res.send('Error al crear el medicamento');
  }
};

async function pintarEditar(req, res, medicamento, form, mensaje, tipo = 'danger') {
  const [lotes, movimientos] = await Promise.all([
    medicamentoModelo.lotes(medicamento.id_medicamento),
    medicamentoModelo.movimientos(medicamento.id_medicamento)
  ]);

  res.render('medicamentos/formulario', {
    ...base(req, 'Editar medicamento'),
    esNuevo: false,
    medicamentoForm: form,
    lotes: lotes.map((l) => ({
      ...l,
      vencido: l.vencido === 1,
      porVencer: l.vencido !== 1 && l.dias_para_vencer !== null && l.dias_para_vencer <= DIAS_AVISO_VENCIMIENTO,
      puedeDarDeBaja: l.vencido === 1 && l.existencia > 0
    })),
    movimientos,
    mensaje,
    tipo: mensaje ? tipo : null
  });
}

exports.mostrarEditar = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medicamento = Number.isNaN(id) ? null : await medicamentoModelo.buscarPorId(id);

    if (!medicamento) return res.redirect('/medicamentos?msg=no_existe');

    const aviso = MENSAJES.get(req.query.msg);
    await pintarEditar(req, res, medicamento, medicamento, aviso ? aviso.texto : null, aviso ? aviso.tipo : 'danger');
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el medicamento');
  }
};

exports.editar = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medicamento = Number.isNaN(id) ? null : await medicamentoModelo.buscarPorId(id);

    if (!medicamento) return res.redirect('/medicamentos?msg=no_existe');

    const { datos, error } = leerMedicamento(req.body);
    const form = { ...medicamento, ...req.body, nombre: datos.nombre, presentacion: datos.presentacion };

    if (error) return pintarEditar(req, res, medicamento, form, error);

    try {
      await medicamentoModelo.editar(id, datos);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return pintarEditar(req, res, medicamento, form, 'Ya existe un medicamento con ese nombre y presentación.');
      throw err;
    }

    res.redirect('/medicamentos?msg=editado');
  } catch (error) {
    console.error(error);
    res.send('Error al editar el medicamento');
  }
};

// Activar o desactivar (no se borra: tiene despachos e historial)
exports.cambiarEstado = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medicamento = Number.isNaN(id) ? null : await medicamentoModelo.buscarPorId(id);

    if (!medicamento) return res.redirect('/medicamentos?msg=no_existe');

    await medicamentoModelo.cambiarEstado(id, medicamento.estado === 1 ? 2 : 1);
    res.redirect('/medicamentos?msg=estado');
  } catch (error) {
    console.error(error);
    res.send('Error al cambiar el estado');
  }
};

// Formulario para ingresar un lote nuevo
exports.mostrarIngreso = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medicamento = Number.isNaN(id) ? null : await medicamentoModelo.buscarPorId(id);

    if (!medicamento) return res.redirect('/medicamentos?msg=no_existe');
    if (medicamento.estado !== 1) return res.redirect('/medicamentos?msg=desactivado');

    res.render('medicamentos/ingreso', {
      ...base(req, 'Ingresar lote'),
      medicamento,
      loteForm: {},
      manana: manana(),
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario');
  }
};

exports.ingresar = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medicamento = Number.isNaN(id) ? null : await medicamentoModelo.buscarPorId(id);

    if (!medicamento) return res.redirect('/medicamentos?msg=no_existe');

    const { lote, error } = leerLote(req.body, false);

    if (error) {
      return res.render('medicamentos/ingreso', {
        ...base(req, 'Ingresar lote'),
        medicamento,
        loteForm: req.body,
        manana: manana(),
        mensaje: error
      });
    }

    const bien = await medicamentoModelo.ingresar(id, lote, req.session.idUsuario);
    res.redirect(`/medicamentos?msg=${bien ? 'ingreso' : 'desactivado'}`);
  } catch (error) {
    console.error(error);
    res.send('Error al ingresar el lote');
  }
};

// Dar de baja un lote vencido
exports.darDeBaja = async (req, res) => {
  try {
    const idLote = parseInt(req.params.idLote, 10);
    const idMedicamento = Number.isNaN(idLote) ? null : await medicamentoModelo.darDeBaja(idLote, req.session.idUsuario);

    if (!idMedicamento) {
      const volver = parseInt(req.body.id_medicamento, 10);
      return res.redirect(Number.isNaN(volver) ? '/medicamentos?msg=baja_no' : `/medicamentos/${volver}/editar?msg=baja_no`);
    }

    res.redirect(`/medicamentos/${idMedicamento}/editar?msg=baja`);
  } catch (error) {
    console.error(error);
    res.send('Error al dar de baja el lote');
  }
};
