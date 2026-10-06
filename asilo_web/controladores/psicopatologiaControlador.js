const psicopatologiaModelo = require('../modelos/psicopatologiaModelo');
const internoModelo = require('../modelos/internoModelo');
const { mayus, mayusParrafo } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?msg=...)
const MENSAJES = new Map([
  ['creado',  { tipo: 'success', texto: 'Padecimiento registrado correctamente.' }],
  ['anulado', { tipo: 'success', texto: 'Padecimiento anulado. Queda en el historial.' }]
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Dibuja la ficha de padecimientos de un interno
async function pintarFicha(req, res, interno, opciones = {}) {
  const padecimientos = await psicopatologiaModelo.listarPorInterno(interno.id_interno);
  const aviso = opciones.msg ? MENSAJES.get(opciones.msg) : null;

  res.render('psicopatologias/ficha', {
    ...base(req, 'Padecimientos'),
    interno,
    padecimientos,
    form: opciones.form || {},
    mensaje: opciones.error || (aviso ? aviso.texto : null),
    tipo: opciones.error ? 'danger' : (aviso ? aviso.tipo : null)
  });
}

// Pantalla de entrada: busca al interno cuyos padecimientos se quieren ver o registrar.
// Así el médico general llega aquí sin necesitar el permiso de ver la lista de internos.
exports.indice = async (req, res) => {
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '';

  try {
    const lista = await psicopatologiaModelo.listarInternos(busqueda);

    res.render('psicopatologias/indice', {
      ...base(req, 'Padecimientos'),
      lista,
      busqueda
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los internos');
  }
};

// Muestra la ficha: datos del interno, formulario y lista de padecimientos
exports.ficha = async (req, res) => {
  try {
    const interno = await internoModelo.buscarFicha(req.params.idInterno);

    if (!interno) {
      return res.redirect('/padecimientos');
    }

    await pintarFicha(req, res, interno, { msg: req.query.msg });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los padecimientos');
  }
};

// Registra un padecimiento nuevo
exports.crear = async (req, res) => {
  try {
    const interno = await internoModelo.buscarFicha(req.params.idInterno);

    if (!interno) {
      return res.redirect('/padecimientos');
    }

    // Regla del proyecto: el texto libre va en MAYÚSCULAS
    const datos = {
      id_interno:          interno.id_interno,
      nombre_padecimiento: mayus(req.body.nombre_padecimiento),
      descripcion:         mayusParrafo(req.body.descripcion) || null,
      medicamento_cajon:   mayus(req.body.medicamento_cajon) || null,
      dosis:               mayus(req.body.dosis) || null
    };

    const reglas = [
      [datos.nombre_padecimiento.length < 3 || datos.nombre_padecimiento.length > 150,
        'El padecimiento debe tener entre 3 y 150 caracteres.'],
      [datos.descripcion && datos.descripcion.length > 1000,
        'La descripción no puede pasar de 1000 caracteres.'],
      [datos.medicamento_cajon && datos.medicamento_cajon.length > 150,
        'El medicamento no puede pasar de 150 caracteres.'],
      [datos.dosis && datos.dosis.length > 100,
        'La dosis no puede pasar de 100 caracteres.']
    ];

    const falla = reglas.find(([falla]) => falla);

    if (falla) {
      return pintarFicha(req, res, interno, { error: falla[1], form: req.body });
    }

    await psicopatologiaModelo.crear(datos);

    res.redirect(`/padecimientos/interno/${interno.id_interno}?msg=creado`);
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el padecimiento');
  }
};

// Anula un padecimiento (no se borra)
exports.anular = async (req, res) => {
  try {
    const registro = await psicopatologiaModelo.buscarPorId(req.params.id);

    if (!registro) {
      return res.redirect('/padecimientos');
    }

    await psicopatologiaModelo.anular(registro.id_psicopatologia);

    res.redirect(`/padecimientos/interno/${registro.id_interno}?msg=anulado`);
  } catch (error) {
    console.error(error);
    res.send('Error al anular el padecimiento');
  }
};
