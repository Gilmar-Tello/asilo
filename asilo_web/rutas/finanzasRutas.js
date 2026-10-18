const express = require('express');
const router = express.Router();
const { requiereLogin, requierePermiso } = require('../middlewares/autenticacion');
const f = require('../controladores/finanzasControlador');

const ver = [requiereLogin, requierePermiso('finanzas:ver', 'finanzas:cobrar', 'finanzas:registrar')];
const cobrar = [requiereLogin, requierePermiso('finanzas:cobrar')];
const registrar = [requiereLogin, requierePermiso('finanzas:registrar')];
const anular = [requiereLogin, requierePermiso('finanzas:anular')];

// Cuentas de familiares y pagos
router.get('/cuentas', ver, f.cuentas);
router.get('/cuentas/:id', ver, f.estadoCuenta);
router.post('/cuentas/:id/pagos', cobrar, f.registrarPago);
router.post('/pagos/:id/anular', anular, f.anularPago);

// Cuotas mensuales
router.get('/cuotas', ver, f.avisoCuotas, f.cuotas);
router.post('/cuotas', cobrar, f.generarCuotas);

// Facturación (OJO: /todo va antes de las rutas con :id)
router.get('/facturacion', ver, f.facturacion);
router.post('/facturacion/todo', cobrar, f.facturarTodo);
router.post('/facturacion/visitas/:id', cobrar, f.facturarVisita);
router.post('/facturacion/despachos/:id', cobrar, f.facturarDespacho);

// Donaciones
router.get('/donaciones', ver, f.donaciones);
router.post('/donaciones', registrar, f.crearDonacion);
router.post('/donaciones/:id/anular', anular, f.anular('donacion', '/finanzas/donaciones'));

// Caja y gastos operativos
router.get('/caja', ver, f.caja);
router.post('/gastos', registrar, f.crearGasto);
router.post('/gastos/:id/anular', anular, f.anular('gasto', '/finanzas/caja'));

// Pagos a la Fundación
router.get('/fundacion', ver, f.fundacion);
router.post('/fundacion/pagos', registrar, f.crearPagoFundacion);
router.post('/fundacion/pagos/:id/anular', anular, f.anular('fundacion', '/finanzas/fundacion'));

module.exports = router;
