const internoModelo = require('../modelos/internoModelo');
const familiarModelo = require('../modelos/familiarModelo');
const parentescoModelo = require('../modelos/parentescoModelo');

// Mensajes fijos que viajan por la URL (?ok=... / ?error=...)
const MENSAJES_OK = new Map([
  ['creado',      'Interno registrado correctamente.'],
  ['actualizado', 'Interno actualizado correctamente.'],
  ['estado',      'Estado del interno actualizado.']
]);

const MENSAJES_ERROR = new Map([
  ['no_existe', 'El interno no existe.'],
  ['familiar_inactivo',
   'No se puede activar: su familiar responsable está desactivado. Actívalo primero o asigna otro familiar desde "Editar".']
]);

// Datos que toda vista con layout necesita (título, usuario y rol de la sesión)
const base = (req, titulo) => ({
  titulo,
  usuario: req.session.usuario,
  rol: req.session.rol
});

// Fecha de hoy como texto AAAA-MM-DD (hora local, no UTC)
function hoyLocal() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// ¿El texto es una fecha real? (rechaza cosas como 2026-02-31)
function fechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(texto + 'T00:00:00Z');
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

// Valida y limpia lo que llega del formulario
function validarDatos(body) {
  const texto = (valor) => String(valor || '').trim().replace(/\s+/g, ' ');
  const mayus = (valor) => texto(valor).toUpperCase();

  const datos = {
    primer_nombre:    mayus(body.primer_nombre),
    segundo_nombre:   mayus(body.segundo_nombre) || null,
    primer_apellido:  mayus(body.primer_apellido),
    segundo_apellido: mayus(body.segundo_apellido) || null,
    apellido_casada:  mayus(body.apellido_casada) || null,
    sexo:             texto(body.sexo),
    dpi:              texto(body.dpi),
    fecha_nacimiento: texto(body.fecha_nacimiento),
    fecha_ingreso:    texto(body.fecha_ingreso),
    padecimientos:    mayus(body.padecimientos) || null,
    id_parentesco:    parseInt(body.id_parentesco, 10),
    id_familiar:      parseInt(body.id_familiar, 10)
  };

  // 1) Los cinco campos de nombre: [etiqueta, valor, ¿obligatorio?]
  const camposNombre = [
    ['primer nombre',      datos.primer_nombre,    true],
    ['segundo nombre',     datos.segundo_nombre,   false],
    ['primer apellido',    datos.primer_apellido,  true],
    ['segundo apellido',   datos.segundo_apellido, false],
    ['apellido de casada', datos.apellido_casada,  false]
  ];

  let error = null;

  for (const [etiqueta, valor, obligatorio] of camposNombre) {
    if (!valor) {
      if (obligatorio) {
        error = `El ${etiqueta} es obligatorio.`;
        break;
      }
      continue;
    }
    if (valor.length > 30 || !/^[\p{L}][\p{L} '.-]*$/u.test(valor)) {
      error = `El ${etiqueta} tiene caracteres no válidos o supera los 30.`;
      break;
    }
  }

  // 2) El resto de reglas: [¿falla?, mensaje]. Se muestra la primera que falle.
  if (!error) {
    const hoy = hoyLocal();
    const reglas = [
      [!['M', 'F'].includes(datos.sexo),             'Selecciona el sexo.'],
      [!/^[0-9]{13}$/.test(datos.dpi),               'El DPI debe tener exactamente 13 dígitos.'],
      [!fechaValida(datos.fecha_nacimiento),         'La fecha de nacimiento no es válida.'],
      [datos.fecha_nacimiento > hoy,                 'La fecha de nacimiento no puede ser futura.'],
      [!fechaValida(datos.fecha_ingreso),            'La fecha de ingreso no es válida.'],
      [datos.fecha_ingreso > hoy,                    'La fecha de ingreso no puede ser futura.'],
      [datos.fecha_ingreso < datos.fecha_nacimiento, 'La fecha de ingreso no puede ser anterior al nacimiento.'],
      [datos.padecimientos && datos.padecimientos.length > 500,
                                                     'Los padecimientos no pueden pasar de 500 caracteres.'],
      [Number.isNaN(datos.id_parentesco),            'Selecciona el parentesco.'],
      [Number.isNaN(datos.id_familiar),              'Busca y elige un familiar responsable.']
    ];

    const falla = reglas.find(([falla]) => falla);
    if (falla) error = falla[1];
  }

  return { datos, error };
}

// ¿El usuario tiene este permiso? (el rol de sistema puede todo)
function tienePermiso(res, clave) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes(clave);
}

// Padecimientos escritos en el formulario de alta. Llegan como listas paralelas:
// padecimiento_nombre[], padecimiento_medicamento[] y padecimiento_dosis[].
// Devuelve todas las filas (hasta 10), incluso las vacías, para poder volver a mostrar el formulario.
function leerPadecimientos(body) {
  // Regla del proyecto: el texto libre va en MAYÚSCULAS
  const limpiar = (valor) => String(valor || '').trim().replace(/\s+/g, ' ').toUpperCase();

  const nombres = [].concat(body.padecimiento_nombre || []);
  const medicamentos = [].concat(body.padecimiento_medicamento || []);
  const dosis = [].concat(body.padecimiento_dosis || []);

  return nombres.slice(0, 10).map((nombre, i) => ({
    nombre: limpiar(nombre),
    medicamento: limpiar(medicamentos[i]),
    dosis: limpiar(dosis[i])
  }));
}

// Revisa las filas con datos. Devuelve el mensaje de error, o null si están bien.
function validarPadecimientos(filas) {
  for (const fila of filas) {
    const escribioAlgo = fila.nombre || fila.medicamento || fila.dosis;

    if (!escribioAlgo) continue;   // fila vacía: se ignora

    if (fila.nombre.length < 3 || fila.nombre.length > 150) {
      return 'Cada padecimiento debe tener un nombre de entre 3 y 150 caracteres.';
    }
    if (fila.medicamento.length > 150) {
      return 'El medicamento no puede pasar de 150 caracteres.';
    }
    if (fila.dosis.length > 100) {
      return 'La dosis no puede pasar de 100 caracteres.';
    }
  }

  return null;
}

// Lo que el formulario necesita además de los datos del interno:
// el familiar elegido (para mostrarlo) y la lista de parentescos
async function cargarOpciones(idFamiliar, idParentesco) {
  const familiarElegido = idFamiliar
    ? (await familiarModelo.buscarPorId(idFamiliar)) || null
    : null;

  const parentescos = await parentescoModelo.listarParaSeleccion(idParentesco);

  return { familiarElegido, parentescos };
}

// Arma lo que necesita la vista del formulario (se usa en crear y en editar)
function vistaFormulario(req, opciones) {
  return {
    ...base(req, opciones.titulo),
    tituloForm: opciones.tituloForm,
    accion: opciones.accion,
    internoForm: opciones.internoForm,
    padecimientosForm: opciones.padecimientosForm && opciones.padecimientosForm.length > 0
      ? opciones.padecimientosForm
      : [{}],
    familiarElegido: opciones.familiarElegido,
    parentescos: opciones.parentescos,
    hoy: hoyLocal(),
    mensaje: opciones.mensaje
  };
}

// Lista los internos, con búsqueda opcional
exports.listar = async (req, res) => {
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '';

  try {
    const lista = await internoModelo.listar(busqueda);

    const error = MENSAJES_ERROR.get(req.query.error);
    const ok = MENSAJES_OK.get(req.query.ok);

    res.render('internos/listar', {
      ...base(req, 'Internos'),
      lista,
      busqueda,
      mensaje: error || ok || null,
      tipo: error ? 'danger' : 'success'
    });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar los internos');
  }
};

// Muestra el formulario vacío
exports.mostrarCrear = async (req, res) => {
  try {
    const opciones = await cargarOpciones(null, null);

    res.render('internos/formulario', vistaFormulario(req, {
      titulo: 'Nuevo interno',
      tituloForm: 'Registrar interno',
      accion: '/internos/crear',
      internoForm: {},
      ...opciones,
      mensaje: null
    }));
  } catch (err) {
    console.error(err);
    res.send('Error al cargar el formulario');
  }
};

// Guarda un interno nuevo
exports.crear = async (req, res) => {
  try {
    const { datos, error } = validarDatos(req.body);
    const opciones = await cargarOpciones(datos.id_familiar, null);

    // Los padecimientos solo se guardan si quien registra puede crearlos
    const puedePadecimientos = tienePermiso(res, 'psicopatologias:crear');
    const padecimientos = puedePadecimientos ? leerPadecimientos(req.body) : [];

    // Vuelve a mostrar el formulario conservando lo que el usuario escribió
    const volver = (mensaje) => res.render('internos/formulario', vistaFormulario(req, {
      titulo: 'Nuevo interno',
      tituloForm: 'Registrar interno',
      accion: '/internos/crear',
      internoForm: datos,
      padecimientosForm: padecimientos,
      ...opciones,
      mensaje
    }));

    if (error) {
      return volver(error);
    }

    // El servidor vuelve a comprobar: el navegador se puede manipular
    const familiar = opciones.familiarElegido;
    if (!familiar || familiar.estado !== 1) {
      return volver('El familiar responsable elegido no es válido o está desactivado.');
    }

    const parentesco = await parentescoModelo.buscarPorId(datos.id_parentesco);
    if (!parentesco || parentesco.estado !== 1) {
      return volver('El parentesco elegido no es válido o está desactivado.');
    }

    const errorPadecimientos = validarPadecimientos(padecimientos);
    if (errorPadecimientos) {
      return volver(errorPadecimientos);
    }

    try {
      // El interno y sus padecimientos se guardan juntos (solo las filas con nombre)
      await internoModelo.crearConPadecimientos(datos, padecimientos.filter((p) => p.nombre));
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe un interno registrado con ese DPI.');
      }
      throw err;
    }

    res.redirect('/internos?ok=creado');
  } catch (err) {
    console.error(err);
    res.send('Error al registrar el interno');
  }
};

// Muestra el formulario con los datos actuales
exports.mostrarEditar = async (req, res) => {
  try {
    const encontrado = await internoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/internos?error=no_existe');
    }

    const opciones = await cargarOpciones(encontrado.id_familiar, encontrado.id_parentesco);

    res.render('internos/formulario', vistaFormulario(req, {
      titulo: 'Editar interno',
      tituloForm: 'Editar interno',
      accion: `/internos/editar/${encontrado.id_interno}`,
      internoForm: encontrado,
      ...opciones,
      mensaje: null
    }));
  } catch (err) {
    console.error(err);
    res.send('Error al cargar el interno');
  }
};

// Guarda los cambios de un interno
exports.actualizar = async (req, res) => {
  try {
    const encontrado = await internoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/internos?error=no_existe');
    }

    const { datos, error } = validarDatos(req.body);
    const opciones = await cargarOpciones(datos.id_familiar, encontrado.id_parentesco);

    const volver = (mensaje) => res.render('internos/formulario', vistaFormulario(req, {
      titulo: 'Editar interno',
      tituloForm: 'Editar interno',
      accion: `/internos/editar/${encontrado.id_interno}`,
      internoForm: { id_interno: encontrado.id_interno, ...datos },
      ...opciones,
      mensaje
    }));

    if (error) {
      return volver(error);
    }

    // El familiar debe estar activo, salvo que sea el mismo que el interno ya tenía
    const familiar = opciones.familiarElegido;
    const esElMismoFamiliar = datos.id_familiar === encontrado.id_familiar;

    if (!familiar || (familiar.estado !== 1 && !esElMismoFamiliar)) {
      return volver('El familiar responsable elegido no es válido o está desactivado.');
    }

    // Igual con el parentesco
    const parentesco = await parentescoModelo.buscarPorId(datos.id_parentesco);
    const esElMismoParentesco = datos.id_parentesco === encontrado.id_parentesco;

    if (!parentesco || (parentesco.estado !== 1 && !esElMismoParentesco)) {
      return volver('El parentesco elegido no es válido o está desactivado.');
    }

    try {
      await internoModelo.actualizar(encontrado.id_interno, datos);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return volver('Ya existe otro interno con ese DPI.');
      }
      throw err;
    }

    res.redirect('/internos?ok=actualizado');
  } catch (err) {
    console.error(err);
    res.send('Error al actualizar el interno');
  }
};

// Activa o desactiva un interno
exports.cambiarEstado = async (req, res) => {
  try {
    const encontrado = await internoModelo.buscarPorId(req.params.id);

    if (!encontrado) {
      return res.redirect('/internos?error=no_existe');
    }

    const nuevoEstado = encontrado.estado === 1 ? 2 : 1;

    // Al ACTIVAR, su familiar responsable también debe estar activo
    if (nuevoEstado === 1) {
      const familiar = await familiarModelo.buscarPorId(encontrado.id_familiar);

      if (!familiar || familiar.estado !== 1) {
        return res.redirect('/internos?error=familiar_inactivo');
      }
    }

    await internoModelo.cambiarEstado(encontrado.id_interno, nuevoEstado);

    res.redirect('/internos?ok=estado');
  } catch (err) {
    console.error(err);
    res.send('Error al cambiar el estado del interno');
  }
};