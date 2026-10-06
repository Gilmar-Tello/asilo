// REGLA DEL PROYECTO: todo texto libre que escribe el usuario se guarda en MAYÚSCULAS
// (nombres, apellidos, descripciones, motivos, evaluaciones...).
//
// Quedan FUERA de la regla: las contraseñas, los correos y el nombre de usuario de acceso.
// Tampoco se tocan los valores de las listas desplegables (por ejemplo 'activo' o 'M'/'F'),
// porque el código los compara tal cual.
//
// En el navegador, public/js/mayusculas.js lo hace mientras se escribe; esto es la GARANTÍA en el
// servidor (el navegador se puede saltar). Todo controlador nuevo debe usar estas funciones.

// Texto limpio: sin espacios al inicio ni al final, y con un solo espacio entre palabras
function texto(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ');
}

// Texto limpio y en MAYÚSCULAS (para campos de una línea)
function mayus(valor) {
  return texto(valor).toUpperCase();
}

// MAYÚSCULAS para cuadros de texto largos: respeta los saltos de línea
function mayusParrafo(valor) {
  return String(valor || '').trim().toUpperCase();
}

module.exports = { texto, mayus, mayusParrafo };
