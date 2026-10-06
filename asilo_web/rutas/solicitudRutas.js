const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const solicitudControlador = require('../controladores/solicitudControlador');

// Quien ve todas las solicitudes o solo las que tiene asignadas (el filtro lo hace el controlador)
const verSolicitudes = [requiereLogin, requierePermiso('solicitudes:ver', 'solicitudes:ver_asignadas')];

router.get('/', verSolicitudes, solicitudControlador.listar);

// OJO: /crear y /buscar-internos van ANTES de /:id, o Express las tomaría por un id
router.get('/crear',           requiereLogin, requierePermiso('solicitudes:crear'), solicitudControlador.mostrarCrear);
router.post('/crear',          requiereLogin, requierePermiso('solicitudes:crear'), solicitudControlador.crear);
router.get('/buscar-internos', requiereLogin, requierePermiso('solicitudes:crear'), solicitudControlador.buscarInternos);

router.get('/:id', verSolicitudes, solicitudControlador.detalle);

router.post('/:id/sincronizar', requiereLogin, requierePermiso('solicitudes:sincronizar'),       solicitudControlador.sincronizar);
router.post('/:id/enfermero',   requiereLogin, requierePermiso('solicitudes:asignar_enfermero'), solicitudControlador.asignarEnfermero);

module.exports = router;
