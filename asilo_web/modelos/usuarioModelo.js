const pool = require('../config/baseDatos');

// Inserta un usuario nuevo y devuelve el id generado
async function crear(datos) {
  const sql = `
    INSERT INTO tbl_usuarios
      (nombre1, nombre2, apellido1, apellido2,
       dpi, telefono, correo,
       titulo, id_especialidad,
       usuario, contrasenia, id_rol, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const valores = [
    datos.nombre1, datos.nombre2, datos.apellido1, datos.apellido2,
    datos.dpi, datos.telefono, datos.correo,
    datos.titulo, datos.id_especialidad,
    datos.usuario, datos.contrasenia, datos.id_rol, datos.estado
  ];

  const [resultado] = await pool.query(sql, valores);
  return resultado.insertId;
}

// Actualiza los datos de un usuario. La contraseña solo se toca si llega un hash nuevo.
// El estado se cambia aparte (activar / desactivar).
async function actualizar(id, datos, hash) {
  let sql = `
    UPDATE tbl_usuarios
       SET nombre1 = ?, nombre2 = ?, apellido1 = ?, apellido2 = ?,
           dpi = ?, telefono = ?, correo = ?,
           titulo = ?, id_especialidad = ?,
           usuario = ?, id_rol = ?
  `;

  const valores = [
    datos.nombre1, datos.nombre2, datos.apellido1, datos.apellido2,
    datos.dpi, datos.telefono, datos.correo,
    datos.titulo, datos.id_especialidad,
    datos.usuario, datos.id_rol
  ];

  if (hash) {
    sql += `, contrasenia = ?`;
    valores.push(hash);
  }

  sql += ` WHERE id_usuario = ?`;
  valores.push(id);

  const [resultado] = await pool.query(sql, valores);
  return resultado.affectedRows;
}

// Lista usuarios, con búsqueda opcional
async function listar(busqueda) {
  let sql = `
    SELECT u.id_usuario, u.nombre1, u.nombre2, u.apellido1, u.apellido2,
           CONCAT_WS(' ', u.nombre1, u.nombre2, u.apellido1, u.apellido2) AS nombre_completo,
           u.dpi, u.telefono, u.correo, u.titulo, e.nombre AS especialidad,
           u.usuario, r.nombre AS rol, REPLACE(r.nombre, '_', ' ') AS rol_texto,
           r.es_sistema, u.estado
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    LEFT JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
  `;

  const valores = [];

  if (busqueda) {
    sql += `
      WHERE CONCAT_WS(' ', u.nombre1, u.nombre2, u.apellido1, u.apellido2) LIKE ?
         OR u.dpi LIKE ?
         OR u.usuario LIKE ?
         OR u.correo LIKE ?
    `;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron, patron, patron);
  }

  sql += ` ORDER BY u.apellido1, u.nombre1`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Cambia el estado: 1 = activo, 2 = desactivado
async function cambiarEstado(id, nuevoEstado) {
  const sql = `UPDATE tbl_usuarios SET estado = ? WHERE id_usuario = ?`;
  const [resultado] = await pool.query(sql, [nuevoEstado, id]);
  return resultado.affectedRows;
}

// Busca un usuario por su id (sin traer la contraseña)
async function buscarPorId(id) {
  const sql = `
    SELECT u.id_usuario, u.nombre1, u.nombre2, u.apellido1, u.apellido2,
           u.dpi, u.telefono, u.correo, u.titulo, u.id_especialidad,
           u.usuario, u.id_rol, r.nombre AS rol, r.es_sistema, u.estado
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    WHERE u.id_usuario = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Igual que buscarPorId, pero con los nombres de columna que usa el formulario
async function buscarParaEditar(id) {
  const sql = `
    SELECT u.id_usuario,
           u.nombre1 AS primer_nombre, u.nombre2 AS segundo_nombre,
           u.apellido1 AS primer_apellido, u.apellido2 AS segundo_apellido,
           u.dpi, u.telefono, u.correo,
           u.titulo AS titulo_academico, u.id_especialidad,
           u.usuario, u.id_rol, r.es_sistema, u.estado
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    WHERE u.id_usuario = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Cuenta cuántos usuarios activos tienen un rol de sistema (el administrador)
async function contarAdminsActivos() {
  const sql = `
    SELECT COUNT(*) AS total
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    WHERE r.es_sistema = 1 AND u.estado = 1
  `;
  const [filas] = await pool.query(sql);
  return filas[0].total;
}

// Busca un usuario por su nombre de usuario (para el login)
async function buscarPorUsuario(nombreUsuario) {
  const sql = `
    SELECT u.id_usuario, u.nombre1, u.apellido1, u.usuario, u.contrasenia,
           u.id_rol, r.nombre AS rol, r.es_sistema, u.estado
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    WHERE u.usuario = ?
  `;
  const [filas] = await pool.query(sql, [nombreUsuario]);
  return filas[0];
}

// Roles que se pueden elegir en el formulario: los activos, más el que el usuario
// ya tiene (aunque esté desactivado), para que al editar no desaparezca
async function listarRolesActivos(idActual) {
  const sql = `
    SELECT id_rol, nombre, REPLACE(nombre, '_', ' ') AS etiqueta,
           descripcion, es_sistema, requiere_especialidad
    FROM tbl_roles
    WHERE estado = 1 OR id_rol = ?
    ORDER BY nombre
  `;
  const [filas] = await pool.query(sql, [idActual || 0]);
  return filas;
}

// Busca un rol por su id (para validar en el controlador)
async function buscarRolPorId(id) {
  const sql = `
    SELECT id_rol, nombre, descripcion, es_sistema, requiere_especialidad, estado
    FROM tbl_roles
    WHERE id_rol = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Médicos especialistas activos: usuarios activos cuyo rol exige especialidad (y no es el rol de sistema)
// y que tienen una especialidad ACTIVA del catálogo. Es la lista que se manda a la Fundación para que
// ella elija entre ellos al programar una cita.
async function listarEspecialistasActivos() {
  const sql = `
    SELECT u.id_usuario AS id_externo,
           CONCAT_WS(' ', u.nombre1, u.nombre2, u.apellido1, u.apellido2) AS nombre_completo,
           e.nombre AS especialidad
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol
    JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
    WHERE u.estado = 1
      AND r.estado = 1
      AND r.es_sistema = 0
      AND r.requiere_especialidad = 1
      AND e.estado = 1
    ORDER BY u.apellido1, u.nombre1
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

module.exports = {
  crear, actualizar, listar, cambiarEstado, buscarPorId, buscarParaEditar,
  contarAdminsActivos, buscarPorUsuario, listarRolesActivos, buscarRolPorId,
  listarEspecialistasActivos
};
