const fundacion = require('./fundacionClient');
const usuarioModelo = require('../modelos/usuarioModelo');

// Manda a la Fundación la lista de médicos especialistas del asilo.
//
// El asilo es quien REGISTRA a los especialistas (el administrador crea usuarios con un rol que exige
// especialidad). La Fundación no tiene los suyos: recibe esta lista y programa las citas entre ellos.
//
// Se ejecuta: al arrancar, cada 5 minutos (ver app.js) y cada vez que se crea, edita o activa/desactiva
// un usuario. NUNCA lanza errores hacia afuera: si la Fundación no responde, el cambio del usuario
// se guarda igual y la lista se manda en la próxima vuelta.

let enCurso = false;
let pendiente = false;

async function sincronizar() {
  // Si ya hay un envío en marcha, se repite una sola vez al terminar (por si cambió otro usuario)
  if (enCurso) {
    pendiente = true;
    return;
  }

  enCurso = true;

  try {
    const lista = await usuarioModelo.listarEspecialistasActivos();
    await fundacion.sincronizarEspecialistas(lista);
  } catch (error) {
    console.error('No se pudieron sincronizar los especialistas con la Fundación:', error.message);
  } finally {
    enCurso = false;

    if (pendiente) {
      pendiente = false;
      sincronizar();
    }
  }
}

module.exports = { sincronizar };
