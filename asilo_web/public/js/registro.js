const formulario = document.querySelector('.formulario');

const campos = [
  'primer_nombre', 'segundo_nombre', 'primer_apellido',
  'segundo_apellido', 'apellido_casada', 'sexo', 'dpi',
  'fecha_nacimiento', 'fecha_ingreso', 'padecimientos',
  'responsable', 'parentesco', 'telefono', 'correo'
];

formulario.addEventListener('submit', function (evento) {
  evento.preventDefault();

  const interno = {};
  campos.forEach(function (campo) {
    interno[campo] = document.getElementById(campo).value;
  });

  const internos = JSON.parse(localStorage.getItem('internos')) || [];
  internos.push(interno);
  localStorage.setItem('internos', JSON.stringify(internos));

  alert('Datos guardados correctamente');
  formulario.reset();
});

const camposMayuscula = [
  'primer_nombre', 'segundo_nombre', 'primer_apellido',
  'segundo_apellido', 'apellido_casada', 'responsable',
  'padecimientos', 'dpi'
];

camposMayuscula.forEach(function (campo) {
  const elemento = document.getElementById(campo);
  elemento.addEventListener('input', function () {
    this.value = this.value.toUpperCase();
  });
});