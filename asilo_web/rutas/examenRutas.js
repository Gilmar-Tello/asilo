const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const examenControlador = require('../controladores/examenControlador');

const ver = [requiereLogin, requierePermiso('examenes:ver', 'examenes:registrar_resultado')];

router.get('/',    ver, examenControlador.listar);
router.get('/:id', ver, examenControlador.detalle);

router.post('/:id/resultado', requiereLogin, requierePermiso('examenes:registrar_resultado'), examenControlador.registrarResultado);
router.post('/:id/anular',    requiereLogin, requierePermiso('examenes:anular'),              examenControlador.anular);

module.exports = router;
