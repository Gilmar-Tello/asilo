const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const familiarControlador = require('../controladores/familiarControlador');

router.get('/',              requiereLogin, requierePermiso('familiares:ver'),    familiarControlador.listar);

// El buscador lo usa el formulario de internos: basta con poder crear o editar internos
router.get('/buscar',        requiereLogin, requierePermiso('internos:crear', 'internos:editar', 'familiares:ver'),
                             familiarControlador.buscar);

router.get('/crear',         requiereLogin, requierePermiso('familiares:crear'),  familiarControlador.mostrarCrear);
router.post('/crear',        requiereLogin, requierePermiso('familiares:crear'),  familiarControlador.crear);

router.get('/editar/:id',    requiereLogin, requierePermiso('familiares:editar'), familiarControlador.mostrarEditar);
router.post('/editar/:id',   requiereLogin, requierePermiso('familiares:editar'), familiarControlador.actualizar);

router.post('/estado/:id',   requiereLogin, requierePermiso('familiares:cambiar_estado'), familiarControlador.cambiarEstado);

module.exports = router;
