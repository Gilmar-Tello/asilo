// REGLA DEL PROYECTO: todo texto que se escribe en un formulario se convierte a MAYÚSCULAS al instante,
// aunque el usuario tenga el teclado en minúsculas.
//
// Se excluyen solos: contraseñas, correos, números, teléfonos, fechas, casillas, listas y campos ocultos.
// Para excluir otro campo de texto (por ejemplo el nombre de usuario), ponle el atributo data-sin-mayusculas.
//
// El servidor también convierte (utilidades/texto.js): esto es la comodidad, aquello es la garantía.

(function () {
  const TIPOS_DE_TEXTO = ['text', 'search'];

  // ¿Este campo debe convertirse?
  function aplica(campo) {
    if (!campo || campo.hasAttribute('data-sin-mayusculas') || campo.readOnly || campo.disabled) {
      return false;
    }
    if (campo.tagName === 'TEXTAREA') {
      return true;
    }
    if (campo.tagName !== 'INPUT') {
      return false;
    }
    return TIPOS_DE_TEXTO.includes((campo.getAttribute('type') || 'text').toLowerCase());
  }

  function convertir(campo) {
    const mayusculas = campo.value.toUpperCase();

    if (mayusculas === campo.value) {
      return;
    }

    const inicio = campo.selectionStart;
    const fin = campo.selectionEnd;

    campo.value = mayusculas;

    // Al cambiar el valor, el cursor saltaría al final: se devuelve a donde estaba
    if (inicio !== null && fin !== null) {
      try {
        campo.setSelectionRange(inicio, fin);
      } catch (error) {
        // algunos tipos de campo no permiten mover el cursor
      }
    }
  }

  // Mientras se escribe, se pega o se autocompleta
  document.addEventListener('input', function (evento) {
    if (evento.isComposing) {
      return;   // el teclado está armando un acento: se espera a que termine
    }
    if (aplica(evento.target)) {
      convertir(evento.target);
    }
  });

  document.addEventListener('compositionend', function (evento) {
    if (aplica(evento.target)) {
      convertir(evento.target);
    }
  });

  // Al abrir la página: se avisa al teclado del celular y se convierte lo que ya venía escrito
  // (por ejemplo, al editar un registro guardado antes en minúsculas)
  function prepararTodo() {
    document.querySelectorAll('input, textarea').forEach(function (campo) {
      if (aplica(campo)) {
        campo.setAttribute('autocapitalize', 'characters');
        convertir(campo);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepararTodo);
  } else {
    prepararTodo();
  }

  // Justo antes de enviar: por si algún texto llegó sin disparar el evento de escritura
  document.addEventListener('submit', function (evento) {
    evento.target.querySelectorAll('input, textarea').forEach(function (campo) {
      if (aplica(campo)) {
        convertir(campo);
      }
    });
  }, true);
})();
