// Formulario de alta de internos: "+ Agregar otro padecimiento" copia una fila vacía.
// (En la pantalla de editar esta sección no existe, por eso se revisa antes de usarla.)
const listaPadecimientos = document.getElementById('lista_padecimientos');
const enlaceAgregar = document.getElementById('agregar_padecimiento');

if (listaPadecimientos && enlaceAgregar) {
  const MAXIMO = 10;

  enlaceAgregar.addEventListener('click', function (evento) {
    evento.preventDefault();

    const filas = listaPadecimientos.querySelectorAll('.fila-padecimiento');

    if (filas.length >= MAXIMO) {
      enlaceAgregar.textContent = 'Máximo ' + MAXIMO + ' padecimientos (los demás se agregan después)';
      return;
    }

    // Se copia la última fila y se le borra lo escrito
    const nueva = filas[filas.length - 1].cloneNode(true);
    nueva.querySelectorAll('input').forEach(function (campo) {
      campo.value = '';
    });

    listaPadecimientos.appendChild(nueva);
    nueva.querySelector('input').focus();
  });
}
