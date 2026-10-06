const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const psicopatologiaControlador = require('../controladores/psicopatologiaControlador');

router.get('/',                    requiereLogin, requierePermiso('psicopatologias:ver'),    psicopatologiaControlador.indice);
router.get('/interno/:idInterno',  requiereLogin, requierePermiso('psicopatologias:ver'),    psicopatologiaControlador.ficha);
router.post('/interno/:idInterno', requiereLogin, requierePermiso('psicopatologias:crear'),  psicopatologiaControlador.crear);
router.post('/:id/anular',         requiereLogin, requierePermiso('psicopatologias:anular'), psicopatologiaControlador.anular);

module.exports = router;
