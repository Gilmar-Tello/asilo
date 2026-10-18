const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const buscarControlador = require('../controladores/buscarControlador');

// Sugerencias de los buscadores. Cada una la puede pedir quien trabaja con ese tipo de dato.
router.get('/internos', requiereLogin, requierePermiso(
  'internos:ver', 'psicopatologias:ver', 'consultas:ver', 'consultas:crear', 'solicitudes:crear',
  'visitas:ver', 'examenes:ver', 'examenes:registrar_resultado', 'medicamentos:despachar', 'medicamentos:ver'
), buscarControlador.internos);

router.get('/medicamentos', requiereLogin, requierePermiso(
  'medicamentos:ver', 'medicamentos:gestionar', 'medicamentos:despachar', 'consultas:crear', 'visitas:atender'
), buscarControlador.medicamentos);

router.get('/familiares', requiereLogin, requierePermiso('familiares:ver', 'internos:crear', 'internos:editar'),
  buscarControlador.familiares);

module.exports = router;
