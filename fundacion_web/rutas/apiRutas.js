const express = require('express');
const router = express.Router();
const { exigirApiKey } = require('../middlewares/apiKey');
const apiControlador = require('../controladores/apiControlador');

// Todo lo que cuelga de /api exige la clave compartida
router.use(exigirApiKey);

router.post('/referencias',          apiControlador.recibirReferencia);
router.get('/referencias/:codigo',   apiControlador.consultarReferencia);
router.get('/especialidades',        apiControlador.listarEspecialidades);
router.put('/especialistas',         apiControlador.sincronizarEspecialistas);

// Cualquier otra ruta de /api: JSON, no una página de error
router.use((req, res) => {
  res.status(404).json({ mensaje: 'Ruta de la API no encontrada' });
});

module.exports = router;
