const express = require('express');
const router = express.Router();
const { requiereLogin } = require('../middlewares/autenticacion');
const referenciaControlador = require('../controladores/referenciaControlador');

router.get('/',                         requiereLogin, referenciaControlador.listar);
router.get('/:codigo',                  requiereLogin, referenciaControlador.detalle);

router.post('/:codigo/programar',       requiereLogin, referenciaControlador.programar);
router.post('/:codigo/reprogramar',     requiereLogin, referenciaControlador.reprogramar);
router.post('/:codigo/esperar',         requiereLogin, referenciaControlador.esperar);
router.post('/:codigo/rechazar',        requiereLogin, referenciaControlador.rechazar);

module.exports = router;
