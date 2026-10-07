// Formulario de la visita médica: agregar y quitar filas de exámenes y de medicamentos.
// Cada botón "+ Agregar" copia el molde (<template>) al cuadro que le toca; "Quitar" borra su fila.
// El servidor vuelve a validar todo (máximo 20 filas por lista): esto es solo comodidad.

(function () {
  var MAXIMO_FILAS = 20;

  document.addEventListener('click', function (evento) {
    var destino = evento.target;

    // Quitar una fila
    if (destino.classList && destino.classList.contains('quitar-fila')) {
      var fila = destino.closest('.fila-dinamica');
      if (fila) fila.remove();
      return;
    }

    // Agregar una fila
    var boton = destino.closest ? destino.closest('[data-agregar]') : null;
    if (!boton) return;

    var contenedor = document.getElementById(boton.getAttribute('data-agregar'));
    var molde = document.getElementById(boton.getAttribute('data-plantilla'));
    if (!contenedor || !molde) return;

    if (contenedor.querySelectorAll('.fila-dinamica').length >= MAXIMO_FILAS) {
      alert('Máximo ' + MAXIMO_FILAS + ' filas por lista.');
      return;
    }

    contenedor.appendChild(molde.content.cloneNode(true));

    // El cursor queda en el primer campo de la fila nueva
    var campos = contenedor.querySelectorAll('.fila-dinamica:last-child input');
    if (campos.length > 0) campos[0].focus();
  });
})();
