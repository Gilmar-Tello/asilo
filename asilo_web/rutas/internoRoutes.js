const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const internoController = require('../controladores/internoController');

router.get('/',              requiereLogin, requierePermiso('internos:ver'),            internoController.listar);

router.get('/crear',         requiereLogin, requierePermiso('internos:crear'),          internoController.mostrarCrear);
router.post('/crear',        requiereLogin, requierePermiso('internos:crear'),          internoController.crear);

router.get('/editar/:id',    requiereLogin, requierePermiso('internos:editar'),         internoController.mostrarEditar);
router.post('/editar/:id',   requiereLogin, requierePermiso('internos:editar'),         internoController.actualizar);

router.post('/estado/:id',   requiereLogin, requierePermiso('internos:cambiar_estado'), internoController.cambiarEstado);

module.exports = router;
