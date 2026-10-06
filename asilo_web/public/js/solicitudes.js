// Formulario de solicitudes: si eligen "Otra" especialidad, aparece el campo para escribirla.
const selectEspecialidad = document.getElementById('especialidad');
const grupoOtra = document.getElementById('grupo_especialidad_otra');
const campoOtra = document.getElementById('especialidad_otra');

function actualizarEspecialidad() {
  const esOtra = selectEspecialidad.value === '__otra__';

  grupoOtra.style.display = esOtra ? '' : 'none';
  campoOtra.required = esOtra;

  if (!esOtra) {
    campoOtra.value = '';
  }
}

selectEspecialidad.addEventListener('change', actualizarEspecialidad);

// También al abrir la página (el formulario puede volver con "Otra" ya elegida)
actualizarEspecialidad();
