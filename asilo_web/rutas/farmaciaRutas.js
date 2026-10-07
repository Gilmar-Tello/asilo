const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const farmaciaControlador = require('../controladores/farmaciaControlador');

const despachar = [requiereLogin, requierePermiso('medicamentos:despachar')];

router.get('/', despachar, farmaciaControlador.cola);

router.get('/interno/:id',  despachar, farmaciaControlador.pos);
router.post('/interno/:id', despachar, farmaciaControlador.despachar);

// Historial y comprobantes: también los ve quien solo consulta el catálogo
const verDespachos = [requiereLogin, requierePermiso('medicamentos:despachar', 'medicamentos:ver')];
router.get('/despachos',     verDespachos, farmaciaControlador.despachos);
router.get('/despachos/:id', verDespachos, farmaciaControlador.comprobante);

module.exports = router;
