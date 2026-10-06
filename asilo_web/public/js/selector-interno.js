// Buscador de internos del formulario de solicitudes.
// Es el mismo patrón del buscador de familiares (selector-familiar.js): un campo oculto
// guarda el id, y el campo visible busca por nombre o DPI mientras se escribe.

const contenedor = document.getElementById('selector_interno');
const campoId = document.getElementById('id_interno');
const buscador = document.getElementById('buscar_interno');
const resultados = document.getElementById('resultados_interno');
const tarjeta = document.getElementById('interno_elegido');
const tarjetaTexto = document.getElementById('interno_elegido_texto');
const enlaceCambiar = document.getElementById('interno_cambiar');
const formulario = buscador.closest('form');

let temporizador = null;   // espera un instante antes de buscar
let numeroBusqueda = 0;    // sirve para ignorar respuestas que llegan tarde
let opciones = [];         // resultados que se están mostrando
let posicion = -1;         // opción resaltada con el teclado

function cerrarResultados() {
  resultados.classList.add('d-none');
  resultados.replaceChildren();
  opciones = [];
  posicion = -1;
}

// Guarda el id en el campo oculto y muestra al interno elegido
function mostrarElegido(id, nombre, dpi) {
  campoId.value = id;
  tarjetaTexto.textContent = `${nombre} (DPI ${dpi})`;
  tarjeta.classList.remove('d-none');
  buscador.classList.add('d-none');
  buscador.setCustomValidity('');
  cerrarResultados();
}

// Quita la selección y vuelve a mostrar el buscador
function limpiarElegido() {
  campoId.value = '';
  tarjeta.classList.add('d-none');
  buscador.classList.remove('d-none');
  buscador.value = '';
  buscador.focus();
}

function resaltar() {
  Array.from(resultados.children).forEach(function (elemento, i) {
    elemento.classList.toggle('active', i === posicion);
  });
}

function pintarResultados(lista, mensajeVacio) {
  resultados.replaceChildren();
  opciones = lista;
  posicion = -1;

  if (lista.length === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'list-group-item text-muted';
    vacio.textContent = mensajeVacio;
    resultados.appendChild(vacio);
  }

  lista.forEach(function (interno) {
    const item = document.createElement('a');
    item.href = '#';
    item.className = 'list-group-item list-group-item-action';
    // textContent (no innerHTML): así un nombre raro nunca se ejecuta como código
    item.textContent = `${interno.nombre_completo} (DPI ${interno.dpi})`;
    item.addEventListener('click', function (evento) {
      evento.preventDefault();
      mostrarElegido(interno.id_interno, interno.nombre_completo, interno.dpi);
    });
    resultados.appendChild(item);
  });

  resultados.classList.remove('d-none');
}

async function buscar(texto) {
  const esteNumero = ++numeroBusqueda;

  try {
    const respuesta = await fetch('/solicitudes/buscar-internos?q=' + encodeURIComponent(texto));
    if (!respuesta.ok) throw new Error('Respuesta no válida');

    const lista = await respuesta.json();
    if (esteNumero !== numeroBusqueda) return;   // llegó tarde: ya se escribió otra cosa

    pintarResultados(lista, 'No se encontraron internos activos.');
  } catch (error) {
    if (esteNumero !== numeroBusqueda) return;
    pintarResultados([], 'No se pudo buscar. Intenta de nuevo.');
  }
}

// Al escribir: espera 300 ms sin teclas nuevas y recién entonces busca
buscador.addEventListener('input', function () {
  buscador.setCustomValidity('');
  clearTimeout(temporizador);

  const texto = buscador.value.trim();

  if (texto.length < 2) {
    numeroBusqueda++;          // cancela cualquier respuesta pendiente
    cerrarResultados();
    return;
  }

  temporizador = setTimeout(function () { buscar(texto); }, 300);
});

// Teclado: flechas para moverse, Enter para elegir, Escape para cerrar
buscador.addEventListener('keydown', function (evento) {
  if (evento.key === 'ArrowDown' && opciones.length > 0) {
    evento.preventDefault();
    posicion = (posicion + 1) % opciones.length;
    resaltar();
  } else if (evento.key === 'ArrowUp' && opciones.length > 0) {
    evento.preventDefault();
    posicion = (posicion - 1 + opciones.length) % opciones.length;
    resaltar();
  } else if (evento.key === 'Enter') {
    evento.preventDefault();   // Enter en este campo nunca envía el formulario
    if (posicion >= 0) {
      const i = opciones[posicion];
      mostrarElegido(i.id_interno, i.nombre_completo, i.dpi);
    }
  } else if (evento.key === 'Escape') {
    cerrarResultados();
  }
});

// Clic fuera del selector: cierra la lista
document.addEventListener('click', function (evento) {
  if (!contenedor.contains(evento.target)) {
    cerrarResultados();
  }
});

enlaceCambiar.addEventListener('click', function (evento) {
  evento.preventDefault();
  limpiarElegido();
});

// No dejar enviar el formulario sin haber elegido un interno de la lista
formulario.addEventListener('submit', function (evento) {
  if (!campoId.value) {
    evento.preventDefault();
    buscador.setCustomValidity('Busca y elige un interno de la lista.');
    buscador.reportValidity();
  }
});

// Al cargar la página (el formulario volvió con un error): mostrar al interno ya elegido
if (contenedor.dataset.id) {
  mostrarElegido(contenedor.dataset.id, contenedor.dataset.nombre, contenedor.dataset.dpi);
}
