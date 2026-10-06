const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const parentescoControlador = require('../controladores/parentescoControlador');

router.get('/',               requiereLogin, requierePermiso('parentescos:ver'),            parentescoControlador.listar);

router.get('/crear',          requiereLogin, requierePermiso('parentescos:crear'),          parentescoControlador.mostrarCrear);
router.post('/crear',         requiereLogin, requierePermiso('parentescos:crear'),          parentescoControlador.crear);

router.get('/editar/:id',     requiereLogin, requierePermiso('parentescos:editar'),         parentescoControlador.mostrarEditar);
router.post('/editar/:id',    requiereLogin, requierePermiso('parentescos:editar'),         parentescoControlador.actualizar);

router.post('/estado/:id',    requiereLogin, requierePermiso('parentescos:cambiar_estado'), parentescoControlador.cambiarEstado);
router.post('/eliminar/:id',  requiereLogin, requierePermiso('parentescos:eliminar'),       parentescoControlador.eliminar);

module.exports = router;
