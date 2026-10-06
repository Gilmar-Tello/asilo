const pool = require('../config/baseDatos');

// Consulta base: la referencia con su especialista (si ya tiene). Las fechas salen como texto.
const SELECT_BASE = `
  SELECT r.id_referencia, r.codigo, r.id_solicitud_asilo,
         r.interno_nombre, r.interno_edad, r.interno_sexo,
         r.especialidad, r.es_externa, r.evaluacion_inicial, r.padecimientos,
         r.estado, r.motivo_rechazo, r.id_especialista,
         DATE_FORMAT(r.fecha_cita, '%Y-%m-%d %H:%i:%s') AS fecha_cita,
         DATE_FORMAT(r.fecha_cita, '%d/%m/%Y %H:%i')    AS fecha_cita_texto,
         DATE_FORMAT(r.fecha_cita, '%Y-%m-%dT%H:%i')    AS fecha_cita_input,
         DATE_FORMAT(r.fecha_recepcion, '%d/%m/%Y %H:%i') AS fecha_recepcion_texto,
         s.nombre_completo AS especialista_nombre,
         s.id_externo      AS especialista_id_externo,
         e.nombre          AS especialista_especialidad
  FROM tbl_referencias r
  LEFT JOIN tbl_especialistas s ON s.id_especialista = r.id_especialista
  LEFT JOIN tbl_especialidades e ON e.id_especialidad = s.id_especialidad
`;

// Lista las referencias, con filtro opcional por estado (las más nuevas primero)
async function listar(estado) {
  let sql = SELECT_BASE;
  const valores = [];

  if (estado) {
    sql += ` WHERE r.estado = ?`;
    valores.push(estado);
  }

  sql += ` ORDER BY r.fecha_recepcion DESC, r.id_referencia DESC`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

async function buscarPorCodigo(codigo) {
  const [filas] = await pool.query(SELECT_BASE + ` WHERE r.codigo = ?`, [codigo]);
  return filas[0];
}

async function buscarPorSolicitudAsilo(idSolicitud) {
  const [filas] = await pool.query(SELECT_BASE + ` WHERE r.id_solicitud_asilo = ?`, [idSolicitud]);
  return filas[0];
}

// Guarda una referencia nueva. El código se arma con el número de la solicitud del asilo,
// y como ese número es único, el código también lo es.
async function crear(datos) {
  const codigo = 'REF-' + String(datos.id_solicitud).padStart(6, '0');

  const sql = `
    INSERT INTO tbl_referencias
      (codigo, id_solicitud_asilo, interno_nombre, interno_edad, interno_sexo,
       especialidad, es_externa, evaluacion_inicial, padecimientos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await pool.query(sql, [
    codigo, datos.id_solicitud, datos.interno_nombre, datos.interno_edad, datos.interno_sexo,
    datos.especialidad, datos.es_externa, datos.evaluacion_inicial, datos.padecimientos
  ]);

  return codigo;
}

// Programa o reprograma: guarda estado, fecha y especialista
async function programar(id, datos) {
  const sql = `
    UPDATE tbl_referencias
       SET estado = ?, fecha_cita = ?, id_especialista = ?, motivo_rechazo = NULL
     WHERE id_referencia = ?
  `;
  await pool.query(sql, [datos.estado, datos.fecha_cita, datos.id_especialista, id]);
}

async function ponerEnEspera(id) {
  const sql = `
    UPDATE tbl_referencias
       SET estado = 'En espera de disponibilidad', fecha_cita = NULL,
           id_especialista = NULL, motivo_rechazo = NULL
     WHERE id_referencia = ?
  `;
  await pool.query(sql, [id]);
}

async function rechazar(id, motivo) {
  const sql = `
    UPDATE tbl_referencias
       SET estado = 'Rechazada', fecha_cita = NULL, id_especialista = NULL, motivo_rechazo = ?
     WHERE id_referencia = ?
  `;
  await pool.query(sql, [motivo, id]);
}

module.exports = {
  listar, buscarPorCodigo, buscarPorSolicitudAsilo, crear,
  programar, ponerEnEspera, rechazar
};
