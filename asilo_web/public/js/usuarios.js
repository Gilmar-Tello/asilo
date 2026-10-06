document.addEventListener('DOMContentLoaded', () => {
  const selectRol = document.getElementById('id_rol');
  const especialidad = document.getElementById('id_especialidad');
  const tituloAcademico = document.getElementById('titulo_academico');
  const labelEspecialidad = document.querySelector('label[for="id_especialidad"]');
  const labelTitulo = document.querySelector('label[for="titulo_academico"]');

  function actualizarObligatorios() {
    // Cada <option> trae data-requiere-especialidad="1" o "0" desde la base de datos
    const opcion = selectRol.options[selectRol.selectedIndex];
    const requiere = opcion.dataset.requiereEspecialidad === '1';

    if (requiere) {
      especialidad.required = true;
      tituloAcademico.required = true;
      labelEspecialidad.textContent = 'Especialidad *';
      labelTitulo.textContent = 'Título Académico *';
    } else {
      especialidad.required = false;
      tituloAcademico.required = false;
      labelEspecialidad.textContent = 'Especialidad';
      labelTitulo.textContent = 'Título Académico';
    }
  }

  // Se ejecuta cada vez que cambia el rol
  selectRol.addEventListener('change', actualizarObligatorios);

  // Y también al abrir la página (al editar, el rol ya viene elegido)
  actualizarObligatorios();
});
