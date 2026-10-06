const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const especialidadControlador = require('../controladores/especialidadControlador');

router.get('/',               requiereLogin, requierePermiso('especialidades:ver'),            especialidadControlador.listar);

router.get('/crear',          requiereLogin, requierePermiso('especialidades:crear'),          especialidadControlador.mostrarCrear);
router.post('/crear',         requiereLogin, requierePermiso('especialidades:crear'),          especialidadControlador.crear);

router.get('/editar/:id',     requiereLogin, requierePermiso('especialidades:editar'),         especialidadControlador.mostrarEditar);
router.post('/editar/:id',    requiereLogin, requierePermiso('especialidades:editar'),         especialidadControlador.actualizar);

router.post('/estado/:id',    requiereLogin, requierePermiso('especialidades:cambiar_estado'), especialidadControlador.cambiarEstado);
router.post('/eliminar/:id',  requiereLogin, requierePermiso('especialidades:eliminar'),       especialidadControlador.eliminar);

module.exports = router;
