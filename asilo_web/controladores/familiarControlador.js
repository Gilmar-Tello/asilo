const familiarModelo = require('../modelos/familiarModelo');
const { mayus } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...)
const MENSAJES_OK = new Map([
  ['creado',      'Familiar registrado correctamente.'],
  ['actualizado', 'Familiar actualizado correctamente.'],
  ['estado',      'Estado del familiar actualizado.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe', 'El familiar no existe.']
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Valida y limpia lo que llega del formulario
function validarDatos(body) {
  const datos = {
    nombre_completo:    mayus(body.nombre_completo),   // regla del proyecto: texto libre en MAYÚSCULAS
    dpi:                String(body.dpi || '').trim(),
    telefono:           String(body.telefono || '').trim(),
    correo_electronico: String(body.correo_electronico || '').trim()
  };

  let error = null;

  if (datos.nombre_completo.length < 3 || datos.nombre_completo.length > 100) {
    error = 'El nombre debe tener entre 3 y 100 caracteres.';
  } else if (!/^[0-9]{13}$/.test(datos.dpi)) {
    error = 'El DPI debe tener exactamente 13 dígitos.';
  } else if (!/^[0-9]{8}$/.test(datos.telefono)) {
    error = 'El teléfono debe tener 8 dígitos.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo_electronico)
             || datos.correo_electronico.length > 100) {
    error = 'El correo electrónico no es válido.';
  }

  return { datos, error };
}

// Lista los familiares, con búsqueda opcional
exports.listar = async (req, res) => {
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '';

  try {
    const lista = await familiarModelo.listar(busqueda);

        let error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    // Este mensaje lleva un número, así que se arma aparte
    if (req.query.error === 'con_internos') {
      const cantidad = parseInt(req.query.cantidad, 10);
      error = `No se puede desactivar: tiene ${cantidad > 0 ? cantidad : 'varios'} interno(s) activo(s) a su cargo. Reasígnalos a otro familiar o desactívalos primero.`;
    }

    res.render('familiares/listar', {
      ...base(req, 'Familiares responsables'),
      lista,
      busqueda,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar los familiares');
  }
};

// Muestra el formulario vacío
exports.mostrarCrear = (req, res) => {
  res.render('familiares/formulario', {
    ...base(req, 'Nuevo familiar'),
    tituloForm: 'Registrar familiar responsable',
    accion: '/familiares/crear',
    familiarForm: { nombre_completo: '', dpi: '', telefono: '', correo_electronico: '' },
    mensaje: null
  });
};

// Guarda un familiar nuevo
exports.crear = async (req, res) => {
  const { datos, error } = validarDatos(req.body);

  // Vuelve a mostrar el formulario conservando lo que el usuario escribió
  const volver = (mensaje) => res.render('familiares/formulario', {
    ...base(req, 'Nuevo familiar'),
    tituloForm: 'Registrar familiar responsable',
    accion: '/familiares/crear',
    familiarForm: datos,
    mensaje
  });

  if (error) {
    return volver(error);
  }

  try {
    await familiarModelo.crear(datos);
    res.redirect('/familiares?ok=creado');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return volver('Ya existe un familiar registrado con ese DPI.');
    }
    console.error(err);
    res.send('Error al registrar el familiar');
  }
};

// Muestra el formulario con los datos actuales
exports.mostrarEditar = async (req, res) => {
  try {
    const encontrado = await familiarModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/familiares?error=no_existe');
    }

    res.render('familiares/formulario', {
      ...base(req, 'Editar familiar'),
      tituloForm: 'Editar familiar responsable',
      accion: `/familiares/editar/${encontrado.id_familiar}`,
      familiarForm: encontrado,
      mensaje: null
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar el familiar');
  }
};

// Guarda los cambios de un familiar
exports.actualizar = async (req, res) => {
  try {
    const encontrado = await familiarModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/familiares?error=no_existe');
    }

    const { datos, error } = validarDatos(req.body);

    const volver = (mensaje) => res.render('familiares/formulario', {
      ...base(req, 'Editar familiar'),
      tituloForm: 'Editar familiar responsable',
      accion: `/familiares/editar/${encontrado.id_familiar}`,
      familiarForm: { id_familiar: encontrado.id_familiar, ...datos },
      mensaje
    });

    if (error) {
      return volver(error);
    }

    try {
      await familiarModelo.actualizar(encontrado.id_familiar, datos);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe otro familiar con ese DPI.');
      }
      throw err;
    }

    res.redirect('/familiares?ok=actualizado');
  } catch (err) {
    console.error(err);
    res.send('Error al actualizar el familiar');
  }
};

// Activa o desactiva un familiar
exports.cambiarEstado = async (req, res) => {
  try {
    const encontrado = await familiarModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/familiares?error=no_existe');
    }

    // Solo al DESACTIVAR se revisa: no se puede si aún tiene internos activos
    if (encontrado.estado === 1) {
      const internos = await familiarModelo.contarInternosActivos(encontrado.id_familiar);

      if (internos > 0) {
        return res.redirect(`/familiares?error=con_internos&cantidad=${internos}`);
      }
    }

    const nuevoEstado = encontrado.estado === 1 ? 2 : 1;
    await familiarModelo.cambiarEstado(encontrado.id_familiar, nuevoEstado);

    res.redirect('/familiares?ok=estado');
  } catch (err) {
    console.error(err);
    res.send('Error al cambiar el estado del familiar');
  }
};

// Buscador del formulario de internos: devuelve JSON, no una página
exports.buscar = async (req, res) => {
  const texto = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  // Con menos de 2 caracteres no se busca: devolvería casi toda la tabla
  if (texto.length < 2) {
    return res.json([]);
  }

  try {
    const resultados = await familiarModelo.buscarActivos(texto);
    res.json(resultados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar' });
  }
};