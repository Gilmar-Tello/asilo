const parentescoModelo = require('../modelos/parentescoModelo');
const { mayus } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...)
const MENSAJES_OK = new Map([
  ['creado',      'Parentesco creado correctamente.'],
  ['actualizado', 'Parentesco actualizado correctamente.'],
  ['estado',      'Estado del parentesco actualizado.'],
  ['eliminado',   'Parentesco eliminado correctamente.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe',    'El parentesco no existe.'],
  ['con_internos', 'No se puede eliminar: hay internos con este parentesco. Desactívalo en su lugar.']
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Valida y limpia el nombre que llega del formulario
function validarNombre(body) {
  const nombre = mayus(body.nombre);   // regla del proyecto: texto libre en MAYÚSCULAS

  let error = null;
  if (nombre.length < 3 || nombre.length > 30) {
    error = 'El nombre debe tener entre 3 y 30 caracteres.';
  } else if (!/^[\p{L}][\p{L} ()\/'.-]*$/u.test(nombre)) {
    error = 'El nombre tiene caracteres no válidos.';
  }

  return { nombre, error };
}

// Lista los parentescos
exports.listar = async (req, res) => {
  try {
    const lista = await parentescoModelo.listar();

    const error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    res.render('parentescos/listar', {
      ...base(req, 'Parentescos'),
      lista,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar los parentescos');
  }
};

// Muestra el formulario vacío
exports.mostrarCrear = (req, res) => {
  res.render('parentescos/formulario', {
    ...base(req, 'Nuevo parentesco'),
    tituloForm: 'Crear parentesco',
    accion: '/parentescos/crear',
    parentescoForm: { nombre: '' },
    mensaje: null
  });
};

// Guarda un parentesco nuevo
exports.crear = async (req, res) => {
  const { nombre, error } = validarNombre(req.body);

  const volver = (mensaje) => res.render('parentescos/formulario', {
    ...base(req, 'Nuevo parentesco'),
    tituloForm: 'Crear parentesco',
    accion: '/parentescos/crear',
    parentescoForm: { nombre },
    mensaje
  });

  if (error) {
    return volver(error);
  }

  try {
    await parentescoModelo.crear(nombre);
    res.redirect('/parentescos?ok=creado');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return volver('Ya existe un parentesco con ese nombre.');
    }
    console.error(err);
    res.send('Error al crear el parentesco');
  }
};

// Muestra el formulario con el nombre actual
exports.mostrarEditar = async (req, res) => {
  try {
    const encontrado = await parentescoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/parentescos?error=no_existe');
    }

    res.render('parentescos/formulario', {
      ...base(req, 'Editar parentesco'),
      tituloForm: 'Editar parentesco',
      accion: `/parentescos/editar/${encontrado.id_parentesco}`,
      parentescoForm: encontrado,
      mensaje: null
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar el parentesco');
  }
};

// Guarda el cambio de nombre
exports.actualizar = async (req, res) => {
  try {
    const encontrado = await parentescoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/parentescos?error=no_existe');
    }

    const { nombre, error } = validarNombre(req.body);

    const volver = (mensaje) => res.render('parentescos/formulario', {
      ...base(req, 'Editar parentesco'),
      tituloForm: 'Editar parentesco',
      accion: `/parentescos/editar/${encontrado.id_parentesco}`,
      parentescoForm: { id_parentesco: encontrado.id_parentesco, nombre },
      mensaje
    });

    if (error) {
      return volver(error);
    }

    try {
      await parentescoModelo.actualizar(encontrado.id_parentesco, nombre);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe otro parentesco con ese nombre.');
      }
      throw err;
    }

    res.redirect('/parentescos?ok=actualizado');
  } catch (err) {
    console.error(err);
    res.send('Error al actualizar el parentesco');
  }
};

// Activa o desactiva un parentesco (uno desactivado deja de ofrecerse en el formulario)
exports.cambiarEstado = async (req, res) => {
  try {
    const encontrado = await parentescoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/parentescos?error=no_existe');
    }

    const nuevoEstado = encontrado.estado === 1 ? 2 : 1;
    await parentescoModelo.cambiarEstado(encontrado.id_parentesco, nuevoEstado);

    res.redirect('/parentescos?ok=estado');
  } catch (err) {
    console.error(err);
    res.send('Error al cambiar el estado del parentesco');
  }
};

// Elimina un parentesco, solo si ningún interno lo usa
exports.eliminar = async (req, res) => {
  try {
    const encontrado = await parentescoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/parentescos?error=no_existe');
    }

    if (encontrado.total_internos > 0) {
      return res.redirect('/parentescos?error=con_internos');
    }

    try {
      await parentescoModelo.eliminar(encontrado.id_parentesco);
    } catch (err) {
      // Por si alguien lo asignó justo entre la comprobación y el borrado
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.redirect('/parentescos?error=con_internos');
      }
      throw err;
    }

    res.redirect('/parentescos?ok=eliminado');
  } catch (err) {
    console.error(err);
    res.send('Error al eliminar el parentesco');
  }
};