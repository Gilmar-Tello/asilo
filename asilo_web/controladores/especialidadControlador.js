const especialidadModelo = require('../modelos/especialidadModelo');
const especialistasFundacion = require('../servicios/especialistasFundacion');
const { mayus } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...)
const MENSAJES_OK = new Map([
  ['creada',      'Especialidad creada correctamente.'],
  ['actualizada', 'Especialidad actualizada correctamente. La Fundación recibirá el cambio en unos minutos.'],
  ['estado',      'Estado de la especialidad actualizado. La Fundación recibirá el cambio en unos minutos.'],
  ['eliminada',   'Especialidad eliminada correctamente.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe',     'La especialidad no existe.'],
  ['con_usuarios',  'No se puede eliminar: hay médicos con esta especialidad. Desactívala en su lugar.']
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Valida y limpia el nombre. Regla del proyecto: el texto libre va en MAYÚSCULAS.
function validarNombre(body) {
  const nombre = mayus(body.nombre);

  let error = null;
  if (nombre.length < 3 || nombre.length > 50) {
    error = 'El nombre debe tener entre 3 y 50 caracteres.';
  } else if (!/^[\p{L}][\p{L} ()\/'.,-]*$/u.test(nombre)) {
    error = 'El nombre tiene caracteres no válidos.';
  }

  return { nombre, error };
}

// Lista las especialidades
exports.listar = async (req, res) => {
  try {
    const lista = await especialidadModelo.listar();

    const error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    res.render('especialidades/listar', {
      ...base(req, 'Especialidades'),
      lista,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar las especialidades');
  }
};

// Muestra el formulario vacío
exports.mostrarCrear = (req, res) => {
  res.render('especialidades/formulario', {
    ...base(req, 'Nueva especialidad'),
    tituloForm: 'Crear especialidad',
    accion: '/especialidades/crear',
    especialidadForm: { nombre: '' },
    mensaje: null
  });
};

// Guarda una especialidad nueva
exports.crear = async (req, res) => {
  const { nombre, error } = validarNombre(req.body);

  const volver = (mensaje) => res.render('especialidades/formulario', {
    ...base(req, 'Nueva especialidad'),
    tituloForm: 'Crear especialidad',
    accion: '/especialidades/crear',
    especialidadForm: { nombre },
    mensaje
  });

  if (error) {
    return volver(error);
  }

  try {
    await especialidadModelo.crear(nombre);
    res.redirect('/especialidades?ok=creada');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return volver('Ya existe una especialidad con ese nombre.');
    }
    console.error(err);
    res.send('Error al crear la especialidad');
  }
};

// Muestra el formulario con el nombre actual
exports.mostrarEditar = async (req, res) => {
  try {
    const encontrada = await especialidadModelo.buscarPorId(req.params.id);

    if (!encontrada) {
      return res.redirect('/especialidades?error=no_existe');
    }

    res.render('especialidades/formulario', {
      ...base(req, 'Editar especialidad'),
      tituloForm: 'Editar especialidad',
      accion: `/especialidades/editar/${encontrada.id_especialidad}`,
      especialidadForm: encontrada,
      mensaje: null
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar la especialidad');
  }
};

// Guarda el cambio de nombre
exports.actualizar = async (req, res) => {
  try {
    const encontrada = await especialidadModelo.buscarPorId(req.params.id);

    if (!encontrada) {
      return res.redirect('/especialidades?error=no_existe');
    }

    const { nombre, error } = validarNombre(req.body);

    const volver = (mensaje) => res.render('especialidades/formulario', {
      ...base(req, 'Editar especialidad'),
      tituloForm: 'Editar especialidad',
      accion: `/especialidades/editar/${encontrada.id_especialidad}`,
      especialidadForm: { id_especialidad: encontrada.id_especialidad, nombre },
      mensaje
    });

    if (error) {
      return volver(error);
    }

    try {
      await especialidadModelo.actualizar(encontrada.id_especialidad, nombre);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe otra especialidad con ese nombre.');
      }
      throw err;
    }

    // Los médicos con esta especialidad cambian de nombre para la Fundación (no espera ni lanza errores)
    especialistasFundacion.sincronizar();

    res.redirect('/especialidades?ok=actualizada');
  } catch (err) {
    console.error(err);
    res.send('Error al actualizar la especialidad');
  }
};

// Activa o desactiva una especialidad.
// Una especialidad desactivada deja de ofrecerse en el formulario de usuarios, y sus médicos
// dejan de contar como especialistas para la Fundación.
exports.cambiarEstado = async (req, res) => {
  try {
    const encontrada = await especialidadModelo.buscarPorId(req.params.id);

    if (!encontrada) {
      return res.redirect('/especialidades?error=no_existe');
    }

    const nuevoEstado = encontrada.estado === 1 ? 2 : 1;
    await especialidadModelo.cambiarEstado(encontrada.id_especialidad, nuevoEstado);

    especialistasFundacion.sincronizar();

    res.redirect('/especialidades?ok=estado');
  } catch (err) {
    console.error(err);
    res.send('Error al cambiar el estado de la especialidad');
  }
};

// Elimina una especialidad, solo si ningún médico la usa
exports.eliminar = async (req, res) => {
  try {
    const encontrada = await especialidadModelo.buscarPorId(req.params.id);

    if (!encontrada) {
      return res.redirect('/especialidades?error=no_existe');
    }

    if (encontrada.total_usuarios > 0) {
      return res.redirect('/especialidades?error=con_usuarios');
    }

    try {
      await especialidadModelo.eliminar(encontrada.id_especialidad);
    } catch (err) {
      // Por si alguien la asignó justo entre la comprobación y el borrado
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.redirect('/especialidades?error=con_usuarios');
      }
      throw err;
    }

    res.redirect('/especialidades?ok=eliminada');
  } catch (err) {
    console.error(err);
    res.send('Error al eliminar la especialidad');
  }
};
