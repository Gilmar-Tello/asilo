const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const rolControlador = require('../controladores/rolControlador');

// Todo el módulo de roles se controla con un solo permiso: "roles:gestionar"
const gestionarRoles = [requiereLogin, requierePermiso('roles:gestionar')];

router.get('/',               gestionarRoles, rolControlador.listar);

router.get('/crear',          gestionarRoles, rolControlador.mostrarCrear);
router.post('/crear',         gestionarRoles, rolControlador.crear);

router.get('/editar/:id',     gestionarRoles, rolControlador.mostrarEditar);
router.post('/editar/:id',    gestionarRoles, rolControlador.actualizar);

router.post('/estado/:id',    gestionarRoles, rolControlador.cambiarEstado);
router.post('/eliminar/:id',  gestionarRoles, rolControlador.eliminar);

module.exports = router;
