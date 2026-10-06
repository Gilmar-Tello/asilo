const referenciaModelo = require('../modelos/referenciaModelo');
const especialistaModelo = require('../modelos/especialistaModelo');

// POST /api/referencias
// El asilo envía una solicitud. Es SEGURO repetirla: si el id_solicitud ya se recibió, se devuelve
// el mismo código y no se crea otra referencia (así un reintento por red lenta no duplica nada).
exports.recibirReferencia = async (req, res) => {
  try {
    const cuerpo = req.body || {};
    const interno = cuerpo.interno || {};

    const idSolicitud = Number.parseInt(cuerpo.id_solicitud, 10);
    const nombre = String(interno.nombre_completo || '').trim();
    const especialidad = String(cuerpo.especialidad || '').trim();
    const evaluacion = String(cuerpo.evaluacion_inicial || '').trim();
    const padecimientos = Array.isArray(cuerpo.padecimientos) ? cuerpo.padecimientos.slice(0, 50) : [];
    const padecimientosJson = JSON.stringify(padecimientos);

    // [¿falla?, mensaje]: se devuelve la primera que falle
    const reglas = [
      [!Number.isInteger(idSolicitud) || idSolicitud <= 0, 'id_solicitud no es válido'],
      [!nombre || nombre.length > 150, 'interno.nombre_completo es obligatorio (máximo 150 caracteres)'],
      [!especialidad || especialidad.length > 50, 'especialidad es obligatoria (máximo 50 caracteres)'],
      [evaluacion.length < 10 || evaluacion.length > 2000, 'evaluacion_inicial debe tener entre 10 y 2000 caracteres'],
      [padecimientosJson.length > 20000, 'padecimientos es demasiado largo']
    ];

    const falla = reglas.find(([falla]) => falla);

    if (falla) {
      return res.status(400).json({ mensaje: falla[1] });
    }

    // ¿Ya la teníamos? Se devuelve lo mismo (200 en vez de 201)
    const existente = await referenciaModelo.buscarPorSolicitudAsilo(idSolicitud);

    if (existente) {
      return res.status(200).json({ codigo: existente.codigo, estado: existente.estado });
    }

    const edad = Number.parseInt(interno.edad, 10);

    try {
      const codigo = await referenciaModelo.crear({
        id_solicitud: idSolicitud,
        interno_nombre: nombre,
        interno_edad: Number.isInteger(edad) ? edad : null,
        interno_sexo: ['M', 'F'].includes(interno.sexo) ? interno.sexo : null,
        especialidad,
        es_externa: cuerpo.es_externa ? 1 : 0,
        evaluacion_inicial: evaluacion,
        padecimientos: padecimientosJson
      });

      return res.status(201).json({ codigo, estado: 'Pendiente de Asignación' });
    } catch (error) {
      // Dos envíos casi simultáneos del mismo id: el segundo choca con el primero
      if (error.code === 'ER_DUP_ENTRY') {
        const yaExiste = await referenciaModelo.buscarPorSolicitudAsilo(idSolicitud);
        if (yaExiste) {
          return res.status(200).json({ codigo: yaExiste.codigo, estado: yaExiste.estado });
        }
      }
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno de la Fundación' });
  }
};

// GET /api/referencias/:codigo  (el seguimiento del "paquete")
exports.consultarReferencia = async (req, res) => {
  try {
    const referencia = await referenciaModelo.buscarPorCodigo(req.params.codigo);

    if (!referencia) {
      return res.status(404).json({ mensaje: 'Referencia no encontrada' });
    }

    res.json({
      codigo: referencia.codigo,
      estado: referencia.estado,
      fecha_cita: referencia.fecha_cita,
      especialista: referencia.id_especialista
        ? {
            id_externo: referencia.especialista_id_externo,   // el id del especialista en el asilo
            nombre: referencia.especialista_nombre,
            especialidad: referencia.especialista_especialidad
          }
        : null,
      motivo_rechazo: referencia.motivo_rechazo
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno de la Fundación' });
  }
};

// PUT /api/especialistas
// El asilo manda la lista COMPLETA de sus médicos especialistas (los registra el administrador del asilo).
// La Fundación los guarda para poder elegirlos al programar una cita. Quien falte en la lista se desactiva.
exports.sincronizarEspecialistas = async (req, res) => {
  try {
    const lista = req.body && req.body.especialistas;

    if (!Array.isArray(lista) || lista.length > 200) {
      return res.status(400).json({ mensaje: 'especialistas debe ser una lista (máximo 200)' });
    }

    const porId = new Map();

    for (const elemento of lista) {
      const idExterno = Number.parseInt(elemento && elemento.id_externo, 10);
      const nombre = String((elemento && elemento.nombre_completo) || '').trim().replace(/\s+/g, ' ');
      const especialidad = String((elemento && elemento.especialidad) || '').trim().replace(/\s+/g, ' ');

      if (!Number.isInteger(idExterno) || idExterno <= 0
          || !nombre || nombre.length > 100
          || !especialidad || especialidad.length > 50) {
        return res.status(400).json({
          mensaje: 'Cada especialista necesita id_externo, nombre_completo (máximo 100) y especialidad (máximo 50)'
        });
      }

      porId.set(idExterno, { id_externo: idExterno, nombre_completo: nombre, especialidad });
    }

    const resultado = await especialistaModelo.sincronizar([...porId.values()]);

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno de la Fundación' });
  }
};

// GET /api/especialidades
exports.listarEspecialidades = async (req, res) => {
  try {
    res.json(await especialistaModelo.listarEspecialidadesActivas());
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno de la Fundación' });
  }
};
