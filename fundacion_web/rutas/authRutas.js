const express = require('express');
const router = express.Router();
const authControlador = require('../controladores/authControlador');

router.get('/login',   authControlador.mostrarLogin);
router.post('/login',  authControlador.procesarLogin);
router.get('/logout',  authControlador.cerrarSesion);

module.exports = router;
