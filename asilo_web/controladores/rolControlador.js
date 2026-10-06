const rolModelo = require('../modelos/rolModelo');
const { mayus } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...).
// Se usa un Map para que solo se acepten claves exactas de esta lista.
const MENSAJES_OK = new Map([
  ['creado',      'Rol creado correctamente.'],
  ['actualizado', 'Rol actualizado correctamente.'],
  ['estado',      'Estado del rol actualizado.'],
  ['eliminado',   'Rol eliminado correctamente.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe',    'El rol no existe.'],
  ['sistema',      'Los roles de sistema no se pueden modificar, desactivar ni eliminar.'],
  ['con_usuarios', 'No se puede eliminar: hay usuarios con este rol. Desactívalo en su lugar.']
]);

// Datos que TODA vista con layout necesita (titulo, usuario y rol de la sesión).
// OJO: el rol que se edita NO se llama "rol" en la vista, para no pisar el rol de la sesión.
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Valida y limpia lo que llega del formulario
function validarDatos(body) {
  // Regla del proyecto: el texto libre va en MAYÚSCULAS
  const nombre = mayus(body.nombre);
  const descripcion = mayus(body.descripcion);
  const requiere = body.requiere_especialidad ? 1 : 0;

  let error = null;
  if (!/^[\p{L}\p{N}_ ]{3,50}$/u.test(nombre)) {
    error = 'El nombre debe tener entre 3 y 50 caracteres (letras, números, espacios o guion bajo).';
  } else if (descripcion.length > 150) {
    error = 'La descripción no puede pasar de 150 caracteres.';
  }

  return { nombre, descripcion: descripcion || null, requiere, error };
}

// Convierte lo que llega en req.body.permisos (nada, un valor o varios)
// en una lista de ids, dejando solo los que existen de verdad
function leerPermisos(body, permisosExistentes) {
  const validos = new Set(permisosExistentes.map(p => p.id_permiso));
  const enviados = [].concat(body.permisos || []).map(Number);
  return [...new Set(enviados.filter(id => validos.has(id)))];
}

// Handlebars no puede agrupar, así que la lista de permisos se agrupa aquí por módulo
function agruparPermisos(permisos, marcados) {
  const porModulo = {};

  permisos.forEach(p => {
    if (!porModulo[p.modulo]) {
      porModulo[p.modulo] = { modulo: p.modulo, permisos: [] };
    }
    porModulo[p.modulo].permisos.push({ ...p, marcado: marcados.has(p.id_permiso) });
  });

  return Object.values(porModulo);
}

// Lista los roles
exports.listar = async (req, res) => {
  try {
    const roles = await rolModelo.listar();

    const error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    res.render('roles/listar', {
      ...base(req, 'Roles y permisos'),
      roles,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los roles');
  }
};

// Muestra el formulario vacío para crear un rol
exports.mostrarCrear = async (req, res) => {
  try {
    const permisos = await rolModelo.listarPermisos();

    res.render('roles/formulario', {
      ...base(req, 'Nuevo rol'),
      tituloForm: 'Crear rol',
      accion: '/roles/crear',
      rolForm: { nombre: '', descripcion: '', requiere_especialidad: 0 },
      grupos: agruparPermisos(permisos, new Set()),
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario');
  }
};

// Guarda un rol nuevo
exports.crear = async (req, res) => {
  try {
    const permisos = await rolModelo.listarPermisos();
    const ids = leerPermisos(req.body, permisos);
    const datos = validarDatos(req.body);

    // Vuelve a mostrar el formulario conservando lo que el usuario escribió
    const volver = (mensaje) => res.render('roles/formulario', {
      ...base(req, 'Nuevo rol'),
      tituloForm: 'Crear rol',
      accion: '/roles/crear',
      rolForm: {
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        requiere_especialidad: datos.requiere
      },
      grupos: agruparPermisos(permisos, new Set(ids)),
      mensaje
    });

    if (datos.error) {
      return volver(datos.error);
    }

    try {
      await rolModelo.crear(datos, ids);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe un rol con ese nombre.');
      }
      throw error;
    }

    res.redirect('/roles?ok=creado');

  } catch (error) {
    console.error(error);
    res.send('Error al crear el rol');
  }
};

// Muestra el formulario con los datos y permisos actuales del rol
exports.mostrarEditar = async (req, res) => {
  try {
    const rolEditado = await rolModelo.buscarPorId(req.params.id);

    if (!rolEditado) {
      return res.redirect('/roles?error=no_existe');
    }
    if (rolEditado.es_sistema === 1) {
      return res.redirect('/roles?error=sistema');
    }

    const permisos = await rolModelo.listarPermisos();
    const asignados = await rolModelo.idsPermisosDeRol(rolEditado.id_rol);

    res.render('roles/formulario', {
      ...base(req, 'Editar rol'),
      tituloForm: 'Editar rol',
      accion: `/roles/editar/${rolEditado.id_rol}`,
      rolForm: rolEditado,
      grupos: agruparPermisos(permisos, new Set(asignados)),
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el rol');
  }
};

// Guarda los cambios de un rol
exports.actualizar = async (req, res) => {
  try {
    const rolEditado = await rolModelo.buscarPorId(req.params.id);

    if (!rolEditado) {
      return res.redirect('/roles?error=no_existe');
    }
    if (rolEditado.es_sistema === 1) {
      return res.redirect('/roles?error=sistema');
    }

    const permisos = await rolModelo.listarPermisos();
    const ids = leerPermisos(req.body, permisos);
    const datos = validarDatos(req.body);

    const volver = (mensaje) => res.render('roles/formulario', {
      ...base(req, 'Editar rol'),
      tituloForm: 'Editar rol',
      accion: `/roles/editar/${rolEditado.id_rol}`,
      rolForm: {
        id_rol: rolEditado.id_rol,
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        requiere_especialidad: datos.requiere
      },
      grupos: agruparPermisos(permisos, new Set(ids)),
      mensaje
    });

    if (datos.error) {
      return volver(datos.error);
    }

    try {
      await rolModelo.actualizar(rolEditado.id_rol, datos, ids);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe un rol con ese nombre.');
      }
      throw error;
    }

    res.redirect('/roles?ok=actualizado');

  } catch (error) {
    console.error(error);
    res.send('Error al actualizar el rol');
  }
};

// Activa o desactiva un rol (un rol desactivado deja de ofrecerse al crear usuarios)
exports.cambiarEstado = async (req, res) => {
  try {
    const encontrado = await rolModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/roles?error=no_existe');
    }
    if (encontrado.es_sistema === 1) {
      return res.redirect('/roles?error=sistema');
    }

    const nuevoEstado = encontrado.estado === 1 ? 2 : 1;
    await rolModelo.cambiarEstado(encontrado.id_rol, nuevoEstado);

    res.redirect('/roles?ok=estado');
  } catch (error) {
    console.error(error);
    res.send('Error al cambiar el estado del rol');
  }
};

// Elimina un rol, solo si nadie lo está usando
exports.eliminar = async (req, res) => {
  try {
    const encontrado = await rolModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/roles?error=no_existe');
    }
    if (encontrado.es_sistema === 1) {
      return res.redirect('/roles?error=sistema');
    }

    const usuarios = await rolModelo.contarUsuarios(encontrado.id_rol);
    if (usuarios > 0) {
      return res.redirect('/roles?error=con_usuarios');
    }

    try {
      await rolModelo.eliminar(encontrado.id_rol);
    } catch (error) {
      // Por si alguien asignó el rol justo entre la comprobación y el borrado
      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.redirect('/roles?error=con_usuarios');
      }
      throw error;
    }

    res.redirect('/roles?ok=eliminado');
  } catch (error) {
    console.error(error);
    res.send('Error al eliminar el rol');
  }
};
