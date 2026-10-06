require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/baseDatos');

async function sembrar() {
  const usuario = process.argv[2];
  const clave   = process.argv[3];

  if (!usuario || !clave) {
    console.log('Uso: node crear-admin.js <usuario> <contrasenia>');
    process.exit(1);
  }

  try {
    // El rol se busca en la tabla de roles: hay que tener su id, no su nombre
    const [roles] = await pool.query(
      `SELECT id_rol FROM tbl_roles WHERE nombre = 'administrador'`
    );

    if (roles.length === 0) {
      console.error('No existe el rol "administrador". Ejecuta primero el SQL de roles y permisos.');
      process.exit(1);
    }

    const idRol = roles[0].id_rol;
    const hash  = await bcrypt.hash(clave, 10);

    const sql = `
      INSERT INTO tbl_usuarios
        (nombre1, apellido1, dpi, correo, usuario, contrasenia, id_rol, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `;

    const [r] = await pool.query(sql, [
      'Gilmar', 'Tello', '2558846561001',
      'tello0310@gmail.com', usuario, hash, idRol
    ]);
    console.log(`Administrador "${usuario}" creado con id ${r.insertId}`);
  } catch (error) {
    console.error('No se pudo crear:', error.message);
  }

  process.exit();
}

sembrar();
