const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const consultaControlador = require('../controladores/consultaControlador');

const ver = [requiereLogin, requierePermiso('consultas:ver', 'consultas:crear')];
const crear = [requiereLogin, requierePermiso('consultas:crear')];

router.get('/', ver, consultaControlador.indice);

// OJO: /nueva va ANTES de /:id
router.get('/nueva/:idInterno',  crear, consultaControlador.mostrarNueva);
router.post('/nueva/:idInterno', crear, consultaControlador.crear);

router.get('/:id', ver, consultaControlador.detalle);
router.post('/:id/anular', requiereLogin, requierePermiso('consultas:anular'), consultaControlador.anular);

module.exports = router;
