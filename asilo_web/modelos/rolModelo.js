const pool = require('../config/baseDatos');

// Lista todos los roles con el conteo de permisos y de usuarios asignados
async function listar() {
  const sql = `
    SELECT r.id_rol, r.nombre, REPLACE(r.nombre, '_', ' ') AS etiqueta,
           r.descripcion, r.es_sistema, r.requiere_especialidad, r.estado,
           (SELECT COUNT(*) FROM tbl_roles_permisos rp
             WHERE rp.id_rol = r.id_rol) AS total_permisos,
           (SELECT COUNT(*) FROM tbl_usuarios u
             WHERE u.id_rol = r.id_rol) AS total_usuarios
    FROM tbl_roles r
    ORDER BY r.es_sistema DESC, r.nombre
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

// Busca un rol por su id
async function buscarPorId(id) {
  const sql = `
    SELECT id_rol, nombre, descripcion, es_sistema, requiere_especialidad, estado
    FROM tbl_roles
    WHERE id_rol = ?
  `;
  const [filas] = await pool.query(sql, [id]);
  return filas[0];
}

// Lista todos los permisos del sistema (para dibujar las casillas)
async function listarPermisos() {
  const sql = `
    SELECT id_permiso, clave, modulo, descripcion
    FROM tbl_permisos
    ORDER BY modulo, clave
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

// Devuelve solo los ids de los permisos que tiene un rol
async function idsPermisosDeRol(idRol) {
  const sql = `SELECT id_permiso FROM tbl_roles_permisos WHERE id_rol = ?`;
  const [filas] = await pool.query(sql, [idRol]);
  return filas.map(fila => fila.id_permiso);
}

// Claves de los permisos de un rol, por ejemplo ['familiares:ver', 'internos:crear'].
// Es lo que se usa para decidir qué menús ve y a qué rutas puede entrar un usuario
async function clavesDePermisos(idRol) {
  const sql = `
    SELECT p.clave
    FROM tbl_roles_permisos rp
    JOIN tbl_permisos p ON p.id_permiso = rp.id_permiso
    WHERE rp.id_rol = ?
  `;
  const [filas] = await pool.query(sql, [idRol]);
  return filas.map(fila => fila.clave);
}

// Cuenta cuántos usuarios tienen este rol
async function contarUsuarios(idRol) {
  const sql = `SELECT COUNT(*) AS total FROM tbl_usuarios WHERE id_rol = ?`;
  const [filas] = await pool.query(sql, [idRol]);
  return filas[0].total;
}

// Crea el rol y sus permisos en UNA transacción:
// o se guarda todo, o no se guarda nada
async function crear(datos, idsPermisos) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [resultado] = await conexion.query(
      `INSERT INTO tbl_roles (nombre, descripcion, requiere_especialidad)
       VALUES (?, ?, ?)`,
      [datos.nombre, datos.descripcion, datos.requiere]
    );
    const idRol = resultado.insertId;

    if (idsPermisos.length > 0) {
      const filas = idsPermisos.map(idPermiso => [idRol, idPermiso]);
      await conexion.query(
        `INSERT INTO tbl_roles_permisos (id_rol, id_permiso) VALUES ?`,
        [filas]
      );
    }

    await conexion.commit();
    return idRol;

  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Actualiza los datos del rol y reemplaza todos sus permisos (también en transacción)
// AND es_sistema = 0: el rol protegido nunca se toca, ni por error
async function actualizar(idRol, datos, idsPermisos) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    await conexion.query(
      `UPDATE tbl_roles
          SET nombre = ?, descripcion = ?, requiere_especialidad = ?
        WHERE id_rol = ? AND es_sistema = 0`,
      [datos.nombre, datos.descripcion, datos.requiere, idRol]
    );

    await conexion.query(
      `DELETE FROM tbl_roles_permisos WHERE id_rol = ?`,
      [idRol]
    );

    if (idsPermisos.length > 0) {
      const filas = idsPermisos.map(idPermiso => [idRol, idPermiso]);
      await conexion.query(
        `INSERT INTO tbl_roles_permisos (id_rol, id_permiso) VALUES ?`,
        [filas]
      );
    }

    await conexion.commit();

  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Cambia el estado: 1 = activo, 2 = desactivado
async function cambiarEstado(idRol, nuevoEstado) {
  const sql = `UPDATE tbl_roles SET estado = ? WHERE id_rol = ? AND es_sistema = 0`;
  const [resultado] = await pool.query(sql, [nuevoEstado, idRol]);
  return resultado.affectedRows;
}

// Elimina el rol; sus filas en tbl_roles_permisos se borran solas (ON DELETE CASCADE)
async function eliminar(idRol) {
  const sql = `DELETE FROM tbl_roles WHERE id_rol = ? AND es_sistema = 0`;
  const [resultado] = await pool.query(sql, [idRol]);
  return resultado.affectedRows;
}

module.exports = {
  listar, buscarPorId, listarPermisos, idsPermisosDeRol, clavesDePermisos, contarUsuarios,
  crear, actualizar, cambiarEstado, eliminar
};
