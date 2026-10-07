const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const medicamentoControlador = require('../controladores/medicamentoControlador');

const gestionar = [requiereLogin, requierePermiso('medicamentos:gestionar')];

router.get('/', requiereLogin, requierePermiso('medicamentos:ver', 'medicamentos:gestionar'), medicamentoControlador.listar);

// OJO: /crear y /lotes van ANTES de /:id
router.get('/crear',  gestionar, medicamentoControlador.mostrarCrear);
router.post('/crear', gestionar, medicamentoControlador.crear);

router.post('/lotes/:idLote/baja', gestionar, medicamentoControlador.darDeBaja);

router.get('/:id/editar',   gestionar, medicamentoControlador.mostrarEditar);
router.post('/:id/editar',  gestionar, medicamentoControlador.editar);
router.post('/:id/estado',  gestionar, medicamentoControlador.cambiarEstado);
router.get('/:id/ingreso',  gestionar, medicamentoControlador.mostrarIngreso);
router.post('/:id/ingreso', gestionar, medicamentoControlador.ingresar);

module.exports = router;
