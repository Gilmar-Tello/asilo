// Crea un usuario del personal de la Fundación (con la contraseña cifrada).
//
// Uso:   node crear-usuario.js <usuario> <contrasenia> [nombre completo]
// Ejemplo: node crear-usuario.js coordinador MiClave123 Coordinación de Referencias

require('dotenv').config({ quiet: true });

const bcrypt = require('bcryptjs');
const pool = require('./config/baseDatos');

async function main() {
  const [usuario, clave, ...resto] = process.argv.slice(2);
  const nombre = resto.join(' ') || usuario;

  if (!usuario || !clave) {
    console.log('Uso: node crear-usuario.js <usuario> <contrasenia> [nombre completo]');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(clave, 10);

    await pool.query(
      'INSERT INTO tbl_usuarios (nombre, usuario, contrasenia) VALUES (?, ?, ?)',
      [nombre, usuario, hash]
    );

    console.log(`Usuario "${usuario}" creado.`);
  } catch (error) {
    console.error('No se pudo crear el usuario:', error.message);
  }

  await pool.end();
}

main();
