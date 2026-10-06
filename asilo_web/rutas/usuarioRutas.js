const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const usuarioControlador = require('../controladores/usuarioControlador');

router.get('/',            requiereLogin, requierePermiso('usuarios:ver'),            usuarioControlador.listar);

router.post('/estado/:id', requiereLogin, requierePermiso('usuarios:cambiar_estado'), usuarioControlador.cambiarEstado);

router.get('/agregar',     requiereLogin, requierePermiso('usuarios:crear'),          usuarioControlador.mostrarAgregar);
router.post('/agregar',    requiereLogin, requierePermiso('usuarios:crear'),          usuarioControlador.agregar);

router.get('/editar/:id',  requiereLogin, requierePermiso('usuarios:editar'),         usuarioControlador.mostrarEditar);
router.post('/editar/:id', requiereLogin, requierePermiso('usuarios:editar'),         usuarioControlador.actualizar);

module.exports = router;
