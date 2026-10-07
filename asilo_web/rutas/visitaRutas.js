const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const visitaControlador = require('../controladores/visitaControlador');

// OJO: /agenda y /atender/... van ANTES de /:id, o Express las tomaría por un id
router.get('/agenda', requiereLogin, requierePermiso('visitas:atender'), visitaControlador.agenda);

router.get('/atender/:idSolicitud',  requiereLogin, requierePermiso('visitas:atender'), visitaControlador.mostrarAtender);
router.post('/atender/:idSolicitud', requiereLogin, requierePermiso('visitas:atender'), visitaControlador.atender);

router.get('/', requiereLogin, requierePermiso('visitas:ver'), visitaControlador.listar);

// El controlador decide: la ve su especialista o quien tenga visitas:ver
router.get('/:id', requiereLogin, requierePermiso('visitas:ver', 'visitas:atender'), visitaControlador.detalle);

module.exports = router;
