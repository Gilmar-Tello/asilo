require('dotenv').config();
const pool = require('./config/baseDatos');

async function probar() {
  const [filas] = await pool.query('SELECT COUNT(*) AS total FROM tbl_usuarios');
  console.log('Conexión OK. Usuarios en la tabla:', filas[0].total);
  process.exit();
}

probar();