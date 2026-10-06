const bcrypt = require('bcryptjs');

const usuarioModelo = require('../modelos/usuarioModelo');
const especialidadModelo = require('../modelos/especialidadModelo');
const especialistasFundacion = require('../servicios/especialistasFundacion');
const { texto, mayus } = require('../utilidades/texto');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...)
const MENSAJES_OK = new Map([
  ['creado',      'Usuario creado correctamente.'],
  ['actualizado', 'Usuario actualizado correctamente.'],
  ['estado',      'Estado del usuario actualizado.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe',    'El usuario no existe.'],
  ['ultimo_admin', 'No se puede desactivar: debe quedar al menos un administrador activo.'],
  ['solo_admin',   'Solo un administrador puede modificar cuentas con rol de sistema.']
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión).
// OJO: el usuario que se edita NO se llama "usuario" en la vista (se llama usuarioForm),
// porque "usuario" ya lo usa el layout para mostrar quién inició sesión.
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Quien no es administrador no puede tocar cuentas con rol de sistema.
// Sin esta regla, cualquiera con el permiso "editar usuarios" podría cambiarle la
// contraseña al administrador y quedarse con el sistema.
function puedeTocar(res, objetivo) {
  return res.locals.rolEsSistema || objetivo.es_sistema !== 1;
}

// Roles que se muestran en el formulario. Quien no es administrador no ve los roles de sistema.
async function cargarRoles(res, idActual) {
  const roles = await usuarioModelo.listarRolesActivos(idActual);
  return res.locals.rolEsSistema ? roles : roles.filter((r) => r.es_sistema !== 1);
}

// Especialidades del catálogo para la lista desplegable (las activas, y la que ya tenía el usuario)
async function cargarEspecialidades(idActual) {
  return especialidadModelo.listarParaSeleccion(idActual);
}

// Valida y limpia lo que llega del formulario.
// esAlta = true al crear (teléfono y contraseña obligatorios); false al editar.
function validarDatos(body, esAlta) {
  const idEspecialidad = parseInt(body.id_especialidad, 10);

  // Regla del proyecto: el texto libre va en MAYÚSCULAS. No se tocan el correo ni el usuario de acceso.
  const datos = {
    primer_nombre:    mayus(body.primer_nombre),
    segundo_nombre:   mayus(body.segundo_nombre) || null,
    primer_apellido:  mayus(body.primer_apellido),
    segundo_apellido: mayus(body.segundo_apellido) || null,
    dpi:              texto(body.dpi),
    telefono:         texto(body.telefono) || null,
    correo:           texto(body.correo),
    titulo_academico: mayus(body.titulo_academico) || null,
    id_especialidad:  Number.isNaN(idEspecialidad) ? null : idEspecialidad,   // viene de una lista del catálogo
    usuario:          texto(body.usuario),
    id_rol:           parseInt(body.id_rol, 10)
  };

  const clave = String(body.clave || '');

  const nombres = [datos.primer_nombre, datos.segundo_nombre, datos.primer_apellido, datos.segundo_apellido];

  // [¿falla?, mensaje]: se muestra la primera que falle
  const reglas = [
    [!datos.primer_nombre,                            'El primer nombre es obligatorio.'],
    [!datos.primer_apellido,                          'El primer apellido es obligatorio.'],
    [nombres.some((n) => n && n.length > 30),         'Los nombres y apellidos no pueden pasar de 30 caracteres.'],
    [!/^[0-9]{13}$/.test(datos.dpi),                  'El DPI debe tener exactamente 13 dígitos.'],
    [esAlta && !datos.telefono,                       'El teléfono es obligatorio.'],
    [datos.telefono && !/^[0-9]{8}$/.test(datos.telefono), 'El teléfono debe tener 8 dígitos.'],
    [!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo) || datos.correo.length > 100,
                                                      'El correo electrónico no es válido.'],
    [datos.titulo_academico && datos.titulo_academico.length > 50, 'El título académico no puede pasar de 50 caracteres.'],
    [datos.usuario.length < 3 || datos.usuario.length > 20,        'El usuario debe tener entre 3 y 20 caracteres.'],
    [esAlta && !clave,                                'La contraseña es obligatoria.'],
    [clave.length > 20,                               'La contraseña no puede pasar de 20 caracteres.'],
    [Number.isNaN(datos.id_rol),                      'Selecciona un rol.']
  ];

  const falla = reglas.find(([falla]) => falla);

  return { datos, clave, error: falla ? falla[1] : null };
}

// Comprueba el rol elegido. idRolActual = el rol que el usuario ya tenía (null si es nuevo).
async function revisarRol(res, datos, idRolActual) {
  const rol = await usuarioModelo.buscarRolPorId(datos.id_rol);

  // Debe existir y estar activo, salvo que sea el mismo que ya tenía
  if (!rol || (rol.estado !== 1 && datos.id_rol !== idRolActual)) {
    return { rol, error: 'El rol elegido no es válido o está desactivado.' };
  }

  // Solo un administrador puede dar un rol de sistema
  if (rol.es_sistema === 1 && !res.locals.rolEsSistema) {
    return { rol, error: 'Solo un administrador puede asignar un rol de sistema.' };
  }

  return { rol, error: null };
}

// Comprueba la especialidad: debe existir en el catálogo y estar activa (salvo que sea la que el
// usuario ya tenía), y es obligatoria si el rol exige especialidad.
async function revisarEspecialidad(rol, datos, idEspecialidadActual) {
  if (datos.id_especialidad) {
    const especialidad = await especialidadModelo.buscarPorId(datos.id_especialidad);

    if (!especialidad || (especialidad.estado !== 1 && datos.id_especialidad !== idEspecialidadActual)) {
      return 'La especialidad elegida no es válida o está desactivada.';
    }
  }

  if (rol.requiere_especialidad === 1 && !datos.id_especialidad) {
    return `La especialidad es obligatoria para el rol "${rol.nombre.replace(/_/g, ' ')}".`;
  }

  return null;
}

// Pasa los datos del formulario a los nombres de columna del modelo
function paraModelo(datos, idRol) {
  return {
    nombre1:         datos.primer_nombre,
    nombre2:         datos.segundo_nombre,
    apellido1:       datos.primer_apellido,
    apellido2:       datos.segundo_apellido,
    dpi:             datos.dpi,
    telefono:        datos.telefono,
    correo:          datos.correo,
    titulo:          datos.titulo_academico,
    id_especialidad: datos.id_especialidad,
    usuario:         datos.usuario,
    id_rol:          idRol
  };
}

// Lista los usuarios, con búsqueda opcional
exports.listar = async (req, res) => {
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '';

  try {
    const filas = await usuarioModelo.listar(busqueda);

    // "editable" decide si se muestran los botones de esa fila
    const lista = filas.map((u) => ({ ...u, editable: puedeTocar(res, u) }));

    const error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    res.render('usuarios/listar', {
      ...base(req, 'Usuarios'),
      lista,
      busqueda,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar los usuarios');
  }
};

// Activa o desactiva un usuario
exports.cambiarEstado = async (req, res) => {
  const id = req.params.id;

  try {
    const encontrado = await usuarioModelo.buscarPorId(id);

    if (!encontrado) {
      return res.redirect('/usuarios?error=no_existe');
    }

    if (!puedeTocar(res, encontrado)) {
      return res.redirect('/usuarios?error=solo_admin');
    }

    // No permitir que el sistema se quede sin administradores activos
    // (es_sistema = 1 marca el rol protegido, sin depender de su nombre)
    if (encontrado.es_sistema === 1 && encontrado.estado === 1) {
      const activos = await usuarioModelo.contarAdminsActivos();
      if (activos <= 1) {
        return res.redirect('/usuarios?error=ultimo_admin');
      }
    }

    // Si está activo lo apaga, si está apagado lo enciende
    const nuevoEstado = encontrado.estado === 1 ? 2 : 1;
    await usuarioModelo.cambiarEstado(id, nuevoEstado);

    // Si cambió un médico especialista, la Fundación se entera (no espera ni lanza errores)
    especialistasFundacion.sincronizar();

    res.redirect('/usuarios?ok=estado');

  } catch (error) {
    console.error(error);
    res.send('Error al cambiar el estado del usuario');
  }
};

// Muestra el formulario vacío para agregar un usuario
exports.mostrarAgregar = async (req, res) => {
  try {
    const roles = await cargarRoles(res, null);
    const especialidades = await cargarEspecialidades(null);

    res.render('usuarios/formulario', {
      ...base(req, 'Agregar usuario'),
      tituloForm: 'Agregar usuario',
      accion: '/usuarios/agregar',
      esEdicion: false,
      usuarioForm: {},
      roles,
      especialidades,
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el formulario');
  }
};

// Procesa el alta de un usuario nuevo
exports.agregar = async (req, res) => {
  try {
    const { datos, clave, error } = validarDatos(req.body, true);
    const roles = await cargarRoles(res, null);
    const especialidades = await cargarEspecialidades(datos.id_especialidad);

    // Vuelve a mostrar el formulario conservando lo que se escribió
    const volver = (mensaje) => res.render('usuarios/formulario', {
      ...base(req, 'Agregar usuario'),
      tituloForm: 'Agregar usuario',
      accion: '/usuarios/agregar',
      esEdicion: false,
      usuarioForm: { ...datos, estado: req.body.estado },
      roles,
      especialidades,
      mensaje
    });

    if (error) {
      return volver(error);
    }

    const revision = await revisarRol(res, datos, null);
    if (revision.error) {
      return volver(revision.error);
    }

    const errorEspecialidad = await revisarEspecialidad(revision.rol, datos, null);
    if (errorEspecialidad) {
      return volver(errorEspecialidad);
    }

    const hash = await bcrypt.hash(clave, 10);

    try {
      await usuarioModelo.crear({
        ...paraModelo(datos, revision.rol.id_rol),
        contrasenia: hash,
        estado: req.body.estado === 'activo' ? 1 : 2
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe un usuario con ese DPI, correo o nombre de usuario.');
      }
      throw err;
    }

    especialistasFundacion.sincronizar();

    res.redirect('/usuarios?ok=creado');

  } catch (error) {
    console.error(error);
    res.send('Error al guardar el usuario');
  }
};

// Muestra el formulario con los datos actuales del usuario
exports.mostrarEditar = async (req, res) => {
  try {
    const encontrado = await usuarioModelo.buscarParaEditar(req.params.id);

    if (!encontrado) {
      return res.redirect('/usuarios?error=no_existe');
    }

    if (!puedeTocar(res, encontrado)) {
      return res.redirect('/usuarios?error=solo_admin');
    }

    const roles = await cargarRoles(res, encontrado.id_rol);
    const especialidades = await cargarEspecialidades(encontrado.id_especialidad);

    res.render('usuarios/formulario', {
      ...base(req, 'Editar usuario'),
      tituloForm: 'Editar usuario',
      accion: `/usuarios/editar/${encontrado.id_usuario}`,
      esEdicion: true,
      usuarioForm: encontrado,
      roles,
      especialidades,
      mensaje: null
    });
  } catch (error) {
    console.error(error);
    res.send('Error al cargar el usuario');
  }
};

// Guarda los cambios de un usuario
exports.actualizar = async (req, res) => {
  try {
    const encontrado = await usuarioModelo.buscarParaEditar(req.params.id);

    if (!encontrado) {
      return res.redirect('/usuarios?error=no_existe');
    }

    if (!puedeTocar(res, encontrado)) {
      return res.redirect('/usuarios?error=solo_admin');
    }

    const { datos, clave, error } = validarDatos(req.body, false);
    const roles = await cargarRoles(res, encontrado.id_rol);
    const especialidades = await cargarEspecialidades(encontrado.id_especialidad);

    const volver = (mensaje) => res.render('usuarios/formulario', {
      ...base(req, 'Editar usuario'),
      tituloForm: 'Editar usuario',
      accion: `/usuarios/editar/${encontrado.id_usuario}`,
      esEdicion: true,
      usuarioForm: { id_usuario: encontrado.id_usuario, ...datos },
      roles,
      especialidades,
      mensaje
    });

    if (error) {
      return volver(error);
    }

    const revision = await revisarRol(res, datos, encontrado.id_rol);
    if (revision.error) {
      return volver(revision.error);
    }

    const errorEspecialidad = await revisarEspecialidad(revision.rol, datos, encontrado.id_especialidad);
    if (errorEspecialidad) {
      return volver(errorEspecialidad);
    }

    // No dejar al sistema sin administradores: el último administrador activo no puede cambiar de rol
    if (encontrado.es_sistema === 1 && encontrado.estado === 1 && revision.rol.es_sistema !== 1) {
      const activos = await usuarioModelo.contarAdminsActivos();
      if (activos <= 1) {
        return volver('No se puede cambiar el rol: debe quedar al menos un administrador activo.');
      }
    }

    // La contraseña solo se cambia si escribieron una nueva
    const hash = clave ? await bcrypt.hash(clave, 10) : null;

    try {
      await usuarioModelo.actualizar(encontrado.id_usuario, paraModelo(datos, revision.rol.id_rol), hash);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe otro usuario con ese DPI, correo o nombre de usuario.');
      }
      throw err;
    }

    // Si se editó a sí mismo, la sesión tiene que enterarse del nombre de usuario nuevo
    if (encontrado.id_usuario === req.session.idUsuario) {
      req.session.usuario = datos.usuario;
      req.session.nombre = `${datos.primer_nombre} ${datos.primer_apellido}`;
    }

    especialistasFundacion.sincronizar();

    res.redirect('/usuarios?ok=actualizado');

  } catch (error) {
    console.error(error);
    res.send('Error al actualizar el usuario');
  }
};
