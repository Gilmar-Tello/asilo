// POS de farmacia: calcula el subtotal de cada línea y el total mientras se escribe,
// y avisa si la cantidad supera la existencia. El servidor vuelve a comprobar TODO con los
// precios del catálogo: esto es solo para que el farmacéutico vea lo que va a cobrar.

(function () {
  var formulario = document.getElementById('form-pos');
  if (!formulario) return;

  function quetzales(valor) {
    return 'Q ' + valor.toFixed(2);
  }

  // El medicamento de la fila: o una lista fija (receta del médico general) o el buscador con su campo oculto
  function medicamentoDe(fila) {
    var lista = fila.querySelector('select.med-select');
    if (lista) {
      var opcion = lista.options[lista.selectedIndex];
      return { id: lista.value, precio: opcion.getAttribute('data-precio'), existencia: opcion.getAttribute('data-existencia') };
    }
    var oculto = fila.querySelector('.med-id');
    return { id: oculto.value, precio: oculto.dataset.precio, existencia: oculto.dataset.existencia };
  }

  function recalcular() {
    var total = 0;

    formulario.querySelectorAll('.fila-pos').forEach(function (fila) {
      var med = medicamentoDe(fila);
      var campo = fila.querySelector('.cantidad');
      var marca = fila.querySelector('.sin-existencia');
      var aviso = fila.querySelector('.aviso-existencia');

      var precio = parseFloat(med.precio) || 0;
      var existencia = parseInt(med.existencia, 10) || 0;
      var cantidad = parseInt(campo.value, 10) || 0;

      // "Sin existencia" y cantidad no van juntos
      if (marca) {
        campo.disabled = marca.checked;
        if (marca.checked) cantidad = 0;
      }

      var faltante = cantidad > 0 && med.id !== '' && cantidad > existencia;
      aviso.classList.toggle('d-none', !faltante);
      campo.classList.toggle('is-invalid', faltante || cantidad > parseInt(fila.getAttribute('data-maximo'), 10));

      var subtotal = med.id === '' ? 0 : precio * cantidad;
      fila.querySelector('.subtotal').textContent = quetzales(subtotal);
      total += subtotal;
    });

    document.getElementById('total-pos').textContent = quetzales(total);
    return total;
  }

  formulario.addEventListener('input', recalcular);
  formulario.addEventListener('change', recalcular);

  formulario.addEventListener('submit', function (evento) {
    // Un campo deshabilitado no se envía: se manda la cantidad en 0 explícita
    formulario.querySelectorAll('.cantidad:disabled').forEach(function (campo) {
      campo.disabled = false;
      campo.value = '0';
    });

    var total = recalcular();
    if (!confirm('¿Confirmar el despacho por ' + quetzales(total) + '? La existencia se descuenta de inmediato.')) {
      evento.preventDefault();
      recalcular();
    }
  });

  recalcular();
})();
