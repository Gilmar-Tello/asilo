const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const c = require('../controladores/correoControlador');

const ver = [requiereLogin, requierePermiso('correos:ver', 'correos:configurar')];
const configurar = [requiereLogin, requierePermiso('correos:configurar')];

// Bitácora de correos enviados (CU-09 paso 6)
router.get('/', ver, c.bitacora);
router.post('/reintentar', configurar, c.reintentarTodos);
router.post('/:id/reintentar', configurar, c.reintentar);
router.post('/probar', configurar, c.probar);

// Plantillas (mensajes predefinidos editables)
router.get('/plantillas', configurar, c.plantillas);
router.get('/plantillas/:id', configurar, c.editarPlantilla);
router.post('/plantillas/:id', configurar, c.guardarPlantilla);

module.exports = router;
