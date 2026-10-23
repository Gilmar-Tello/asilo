const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const r = require('../controladores/reporteControlador');

const ver = [requiereLogin, requierePermiso('reportes:ver')];

router.get('/', ver, r.indice);
router.get('/:clave', ver, r.ver);   // ?desde=&hasta=&interno=&formato=pantalla|pdf|excel

module.exports = router;
