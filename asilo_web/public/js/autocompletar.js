// BUSCADOR CON SUGERENCIAS (para todo el sistema).
// Mientras se escribe, pregunta al servidor y muestra una lista para elegir; así no hay que deslizar
// por un combobox de cientos de opciones.
//
// Se activa poniendo atributos al <input>:
//   data-autocompletar="/buscar/internos"   -> de dónde salen las sugerencias (JSON)
//   data-modo="..."                          -> qué pasa al elegir una sugerencia:
//        enviar : escribe el nombre en el campo y envía su formulario (buscadores de listas)
//        ir     : abre la página de data-ir, cambiando {id} por el elegido (ej. /consultas/nueva/{id})
//        elegir : guarda el id en el <input type="hidden" class="ac-valor"> del mismo .ac-grupo
//                 (y es obligatorio elegir de la lista si se escribió algo)
//        texto  : solo escribe el nombre (se puede escribir otro que no esté en la lista)
//
// El servidor responde [{ id, etiqueta, detalle, ...datos }]. Los "datos" extra (ej. precio, existencia)
// se copian al campo oculto como data-*, para que otros scripts los lean.
// Funciona también con filas que se agregan después (el "+ Agregar" de las recetas): escucha en todo el documento.

(function () {
  var ESPERA_MS = 250;
  var temporizadores = new WeakMap();
  var numeros = new WeakMap();   // para ignorar respuestas que llegan tarde

  function esBuscador(el) {
    return el && el.matches && el.matches('input[data-autocompletar]');
  }

  // La lista se crea la primera vez, justo debajo del campo
  function listaDe(campo) {
    var lista = campo.nextElementSibling;
    if (lista && lista.classList.contains('ac-lista')) return lista;

    lista = document.createElement('div');
    lista.className = 'ac-lista list-group position-absolute shadow d-none';
    lista.style.zIndex = '1060';
    lista.style.maxHeight = '320px';
    lista.style.overflowY = 'auto';
    lista.style.minWidth = '100%';
    campo.parentNode.style.position = 'relative';
    campo.insertAdjacentElement('afterend', lista);
    return lista;
  }

  function ocultoDe(campo) {
    var grupo = campo.closest('.ac-grupo');
    return grupo ? grupo.querySelector('.ac-valor') : null;
  }

  function cerrar(campo) {
    var lista = listaDe(campo);
    lista.classList.add('d-none');
    lista.replaceChildren();
    campo._opciones = [];
    campo._posicion = -1;
  }

  function resaltar(campo) {
    Array.from(listaDe(campo).children).forEach(function (el, i) {
      el.classList.toggle('active', i === campo._posicion);
    });
  }

  function pintar(campo, opciones, vacio) {
    var lista = listaDe(campo);
    lista.replaceChildren();
    campo._opciones = opciones;
    campo._posicion = -1;

    if (opciones.length === 0) {
      var nada = document.createElement('div');
      nada.className = 'list-group-item small text-muted';
      nada.textContent = vacio;
      lista.appendChild(nada);
    }

    opciones.forEach(function (op) {
      var item = document.createElement('a');
      item.href = '#';
      item.className = 'list-group-item list-group-item-action py-1';
      // textContent (no innerHTML): un nombre raro nunca se ejecuta como código
      var titulo = document.createElement('div');
      titulo.textContent = op.etiqueta;
      item.appendChild(titulo);
      if (op.detalle) {
        var sub = document.createElement('div');
        sub.className = 'small text-muted';
        sub.textContent = op.detalle;
        item.appendChild(sub);
      }
      // mousedown (no click): ocurre ANTES de que el campo pierda el foco y se cierre la lista
      item.addEventListener('mousedown', function (evento) {
        evento.preventDefault();
        elegir(campo, op);
      });
      lista.appendChild(item);
    });

    lista.classList.remove('d-none');
  }

  function elegir(campo, op) {
    var modo = campo.dataset.modo || 'texto';
    cerrar(campo);

    if (modo === 'ir') {
      window.location.href = (campo.dataset.ir || '').replace('{id}', encodeURIComponent(op.id));
      return;
    }

    campo.value = op.etiqueta;
    campo.setCustomValidity('');

    if (modo === 'elegir') {
      var oculto = ocultoDe(campo);
      if (oculto) {
        oculto.value = op.id;
        Object.keys(op).forEach(function (clave) {
          if (['id', 'etiqueta', 'detalle'].indexOf(clave) === -1) oculto.dataset[clave] = op[clave];
        });
        oculto.dispatchEvent(new Event('change', { bubbles: true }));
      }
      campo.classList.add('is-valid');
    }

    if (modo === 'enviar' && campo.form) {
      campo.form.submit();
    }
  }

  async function buscar(campo, texto) {
    var numero = (numeros.get(campo) || 0) + 1;
    numeros.set(campo, numero);

    try {
      var url = campo.dataset.autocompletar;
      var respuesta = await fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'q=' + encodeURIComponent(texto));
      if (!respuesta.ok) throw new Error('respuesta no válida');
      var opciones = await respuesta.json();
      if (numeros.get(campo) !== numero) return;   // llegó tarde: ya se escribió otra cosa
      pintar(campo, opciones, 'Sin coincidencias.');
    } catch (error) {
      if (numeros.get(campo) !== numero) return;
      pintar(campo, [], 'No se pudo buscar. Intenta de nuevo.');
    }
  }

  // Al escribir: espera un instante sin teclas nuevas y busca
  document.addEventListener('input', function (evento) {
    var campo = evento.target;
    if (!esBuscador(campo)) return;
    campo.setCustomValidity('');

    // Si cambió el texto, lo elegido antes ya no vale
    if (campo.dataset.modo === 'elegir') {
      var oculto = ocultoDe(campo);
      if (oculto && oculto.value) {
        oculto.value = '';
        oculto.dispatchEvent(new Event('change', { bubbles: true }));
      }
      campo.classList.remove('is-valid');
    }

    clearTimeout(temporizadores.get(campo));
    var texto = campo.value.trim();

    if (texto.length < 2) {
      numeros.set(campo, (numeros.get(campo) || 0) + 1);
      cerrar(campo);
      return;
    }

    temporizadores.set(campo, setTimeout(function () { buscar(campo, texto); }, ESPERA_MS));
  });

  // Teclado: flechas, Enter para elegir, Escape para cerrar
  document.addEventListener('keydown', function (evento) {
    var campo = evento.target;
    if (!esBuscador(campo)) return;
    var opciones = campo._opciones || [];

    if (evento.key === 'ArrowDown' && opciones.length > 0) {
      evento.preventDefault();
      campo._posicion = (campo._posicion + 1) % opciones.length;
      resaltar(campo);
    } else if (evento.key === 'ArrowUp' && opciones.length > 0) {
      evento.preventDefault();
      campo._posicion = (campo._posicion - 1 + opciones.length) % opciones.length;
      resaltar(campo);
    } else if (evento.key === 'Enter' && campo._posicion >= 0) {
      evento.preventDefault();
      elegir(campo, opciones[campo._posicion]);
    } else if (evento.key === 'Enter' && campo.dataset.modo !== 'enviar') {
      evento.preventDefault();   // en los demás modos, Enter no envía el formulario a medias
    } else if (evento.key === 'Escape') {
      cerrar(campo);
    }
  });

  // Al salir del campo se cierra la lista
  document.addEventListener('focusout', function (evento) {
    if (esBuscador(evento.target)) cerrar(evento.target);
  });

  // Modo elegir: si se escribió algo pero no se eligió de la lista, no se deja enviar
  document.addEventListener('submit', function (evento) {
    var malos = Array.from(evento.target.querySelectorAll('input[data-autocompletar][data-modo="elegir"]'))
      .filter(function (campo) {
        var oculto = ocultoDe(campo);
        return campo.value.trim() !== '' && oculto && !oculto.value;
      });

    if (malos.length > 0) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      malos[0].setCustomValidity('Elige una opción de la lista de sugerencias.');
      malos[0].reportValidity();
    }
  }, true);
})();
