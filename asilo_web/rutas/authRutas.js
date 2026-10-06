const { requiereLogin, requiereAdmin } = require('../middlewares/autenticacion');

const express = require('express');
const router = express.Router();
const authControlador = require('../controladores/authControlador');

// Muestra la pantalla de login
router.get('/login', authControlador.mostrarLogin);

// Procesa el envío del formulario
router.post('/login', authControlador.procesarLogin);

// Dashboard protegido
router.get('/dashboard', requiereLogin, authControlador.mostrarDashboard);

// Cerrar sesión
router.get('/logout', authControlador.cerrarSesion);

module.exports = router;