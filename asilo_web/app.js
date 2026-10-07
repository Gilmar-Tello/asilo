require('dotenv').config();

const express = require('express');
const path = require('path');
const { engine } = require('express-handlebars');
const app = express();

//motor de vistas: Handlebars (.hbs)
app.set('views', path.join(__dirname, 'views'));
app.engine('.hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'parciales'),
    helpers: {
        // Handlebars no compara valores; este helper responde: (eq a b) -> a === b
        eq: (a, b) => a === b,

        // {{#if (puede 'internos:ver')}} -> ¿el usuario tiene ese permiso?
        // Con varias claves responde que sí si tiene ALGUNA: (puede 'a' 'b')
        puede: (...argumentos) => {
            const opciones = argumentos.pop();   // el último argumento siempre lo agrega Handlebars
            const raiz = opciones.data.root;     // los datos de toda la página (incluye res.locals)

            if (raiz.rolEsSistema) return true;  // el administrador puede todo

            const mios = raiz.misPermisos || [];
            return argumentos.some((clave) => mios.includes(clave));
        }
    }
}));
app.set('view engine', '.hbs');

//lee los ddatos de formularios
app.use(express.urlencoded({ extended: true}));

//lee archivos de public, css, js, img
app.use(express.static('public'));

const session = require('express-session');

app.use(session({
    secret: 'asilo_cabeza_algodon_2026',
    resave: false,
    saveUninitialized: false
}));

// En cada petición: carga los permisos del usuario (para el menú y para requierePermiso)
const { cargarPermisos } = require('./middlewares/autenticacion');
app.use(cargarPermisos);

//rutas
const usuarioRutas = require('./rutas/usuarioRutas');
app.use('/usuarios', usuarioRutas);

const rolRutas = require('./rutas/rolRutas');
app.use('/roles', rolRutas);

const familiarRutas = require('./rutas/familiarRutas');
app.use('/familiares', familiarRutas);

const parentescoRutas = require('./rutas/parentescoRutas');
app.use('/parentescos', parentescoRutas);

const especialidadRutas = require('./rutas/especialidadRutas');
app.use('/especialidades', especialidadRutas);

const internoRoutes = require('./rutas/internoRoutes');
app.use('/internos', internoRoutes);

const psicopatologiaRutas = require('./rutas/psicopatologiaRutas');
app.use('/padecimientos', psicopatologiaRutas);

const solicitudRutas = require('./rutas/solicitudRutas');
app.use('/solicitudes', solicitudRutas);

const visitaRutas = require('./rutas/visitaRutas');
app.use('/visitas', visitaRutas);

const examenRutas = require('./rutas/examenRutas');
app.use('/examenes', examenRutas);

const medicamentoRutas = require('./rutas/medicamentoRutas');
app.use('/medicamentos', medicamentoRutas);

const farmaciaRutas = require('./rutas/farmaciaRutas');
app.use('/farmacia', farmaciaRutas);

const authRutas = require('./rutas/authRutas');
app.use('/', authRutas);

const PUERTO = process.env.PORT || 3001;

app.listen(PUERTO, () => {
    console.log(`Servidor en http://localhost:${PUERTO}`);

    // Cada 5 minutos: reenvía a la Fundación lo que no se pudo enviar y consulta cómo van las solicitudes pendientes
    const sincronizador = require('./servicios/sincronizadorSolicitudes');
    sincronizador.sincronizarPendientes();
    setInterval(sincronizador.sincronizarPendientes, 5 * 60 * 1000);

    // Los médicos especialistas del asilo se mandan a la Fundación al arrancar y cada 5 minutos
    // (además, cada vez que se crea, edita o activa/desactiva un usuario)
    const especialistasFundacion = require('./servicios/especialistasFundacion');
    especialistasFundacion.sincronizar();
    setInterval(especialistasFundacion.sincronizar, 5 * 60 * 1000);

    // Visitas cuyo costo quedó "pendiente de cálculo" porque el microservicio de costos (puerto 3000)
    // no respondía: se reintentan al arrancar y cada 5 minutos
    const calculadorCostos = require('./servicios/calculadorCostos');
    calculadorCostos.reprocesarPendientes();
    setInterval(calculadorCostos.reprocesarPendientes, 5 * 60 * 1000);
});