require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const { engine } = require('express-handlebars');

const app = express();

// Detrás de un proxy con HTTPS (producción), Express tiene que confiar en él para las cookies seguras
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Motor de vistas: Handlebars (.hbs)
app.set('views', path.join(__dirname, 'views'));
app.engine('.hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views', 'layouts'),
  helpers: {
    eq: (a, b) => a === b
  }
}));
app.set('view engine', '.hbs');

// La API recibe JSON (con tope de tamaño); los formularios de la pantalla, datos de formulario
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'solo-para-desarrollo',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Bitácora de la API: cada llamada que llega queda escrita en la consola (método, ruta y resultado;
// nunca la clave ni los datos de los pacientes). Útil para mostrar la comunicación entre los dos sistemas.
app.use('/api', (req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - inicio} ms)`);
  });
  next();
});

// La API (para el asilo) y la pantalla web (para el personal de la Fundación)
app.use('/api', require('./rutas/apiRutas'));
app.use('/', require('./rutas/authRutas'));
app.use('/referencias', require('./rutas/referenciaRutas'));

app.get('/', (req, res) => {
  res.redirect('/referencias');
});

// Errores no controlados. En /api responde JSON (por ejemplo, si el JSON llega mal escrito).
app.use((error, req, res, next) => {
  console.error(error.message);

  if (req.path.startsWith('/api')) {
    const codigo = error.status || error.statusCode || 500;
    return res.status(codigo).json({
      mensaje: codigo === 400 ? 'El cuerpo de la petición no es un JSON válido' : 'Error interno de la Fundación'
    });
  }

  res.status(500).send('Error interno');
});

const PUERTO = process.env.PORT || 3002;

app.listen(PUERTO, () => {
  console.log(`Fundación en http://localhost:${PUERTO}`);

  if (!process.env.API_KEY) {
    console.warn('AVISO: falta API_KEY en el .env; la API responderá 503 hasta que la agregues.');
  }
});
