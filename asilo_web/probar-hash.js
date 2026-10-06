const bcrypt = require('bcryptjs');

async function probar() {
  const clave = '123';

  const hash1 = await bcrypt.hash(clave, 10);
  const hash2 = await bcrypt.hash(clave, 10);

  console.log('Hash 1:', hash1);
  console.log('Hash 2:', hash2);

  console.log('¿"123" coincide con hash1?', await bcrypt.compare('123', hash1));
  console.log('¿"124" coincide con hash1?', await bcrypt.compare('124', hash1));
}

probar();