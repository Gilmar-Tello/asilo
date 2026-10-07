const pool = require('../config/baseDatos');

// Estados en los que la solicitud sigue "viva" y vale la pena consultar a la Fundación
const ESTADOS_ACTIVOS = [
  'Pendiente de Asignación',
  'En espera de disponibilidad',
  'Programada',
  'Reprogramada'
];

// Consulta base: la solicitud con los nombres del interno, del médico y del enfermero.
// Las fechas salen ya como texto, para no pelear con zonas horarias.
const SELECT_BASE = `
  SELECT s.id_solicitud, s.id_interno, s.especialidad_requerida, s.es_externa,
         s.evaluacion_inicial, s.estado, s.codigo_fundacion,
         s.especialista_nombre, s.motivo_rechazo, s.id_enfermero_asignado,
         DATE_FORMAT(s.fecha_cita, '%d/%m/%Y %H:%i')       AS fecha_cita_texto,
         DATE_FORMAT(s.fecha_cita, '%Y-%m-%d %H:%i:%s')    AS fecha_cita_sql,
         DATE_FORMAT(s.fecha_creacion, '%d/%m/%Y %H:%i')   AS fecha_creacion_texto,
         DATE_FORMAT(s.ultima_sincronizacion, '%d/%m/%Y %H:%i') AS sincronizacion_texto,
         TIMESTAMPDIFF(SECOND, s.ultima_sincronizacion, NOW())  AS segundos_sin_sincronizar,
         CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS interno_nombre,
         TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
         i.sexo AS interno_sexo,
         CONCAT_WS(' ', m.nombre1, m.apellido1) AS medico_nombre,
         CONCAT_WS(' ', e.nombre1, e.apellido1) AS enfermero_nombre
  FROM tbl_solicitudes_referencia s
  JOIN tbl_internos i ON i.id_interno = s.id_interno
  JOIN tbl_usuarios m ON m.id_usuario = s.id_medico_general
  LEFT JOIN tbl_usuarios e ON e.id_usuario = s.id_enfermero_asignado
`;

// Lista las solicitudes.
//   idEnfermero: si viene, SOLO devuelve las que ese enfermero debe acompañar (el filtro va en
//                el SQL, no en la pantalla, para que nadie vea ajenas escribiendo la URL)
//   estado: filtra por un estado
async function listar({ idEnfermero, estado } = {}) {
  let sql = SELECT_BASE;
  const condiciones = [];
  const valores = [];

  if (idEnfermero) {
    condiciones.push(`s.id_enfermero_asignado = ?`);
    valores.push(idEnfermero);
    condiciones.push(`s.estado IN ('Programada', 'Reprogramada')`);
  }

  if (estado) {
    condiciones.push(`s.estado = ?`);
    valores.push(estado);
  }

  if (condiciones.length > 0) {
    sql += ` WHERE ` + condiciones.join(' AND ');
  }

  sql += ` ORDER BY s.fecha_creacion DESC, s.id_solicitud DESC`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Busca una solicitud. Con idEnfermero, solo la devuelve si es de ese enfermero
// (si no, devuelve undefined: para él "no existe").
async function buscarPorId(id, idEnfermero) {
  let sql = SELECT_BASE + ` WHERE s.id_solicitud = ?`;
  const valores = [id];

  if (idEnfermero) {
    sql += ` AND s.id_enfermero_asignado = ? AND s.estado IN ('Programada', 'Reprogramada')`;
    valores.push(idEnfermero);
  }

  const [filas] = await pool.query(sql, valores);
  return filas[0];
}

// Guarda una solicitud nueva (queda "Pendiente de Asignación") y devuelve su id
async function crear(datos) {
  const sql = `
    INSERT INTO tbl_solicitudes_referencia
      (id_interno, id_medico_general, especialidad_requerida, es_externa, evaluacion_inicial)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [resultado] = await pool.query(sql, [
    datos.id_interno, datos.id_medico_general, datos.especialidad_requerida,
    datos.es_externa, datos.evaluacion_inicial
  ]);
  return resultado.insertId;
}

// La Fundación recibió la solicitud: se guarda su número de guía y el estado que devolvió
async function marcarPublicada(id, codigo, estado) {
  const sql = `
    UPDATE tbl_solicitudes_referencia
       SET codigo_fundacion = ?, estado = ?, ultima_sincronizacion = NOW()
     WHERE id_solicitud = ?
  `;
  await pool.query(sql, [codigo, estado, id]);
}

// Guarda lo que respondió la Fundación al consultar. Si desasignar es true, se le quita el
// enfermero (cambió la fecha o la solicitud ya no está programada: hay que asignar de nuevo).
async function aplicarDeFundacion(id, datos) {
  const sql = `
    UPDATE tbl_solicitudes_referencia
       SET estado = ?, fecha_cita = ?, especialista_nombre = ?, id_especialista = ?, motivo_rechazo = ?,
           id_enfermero_asignado = IF(?, NULL, id_enfermero_asignado),
           ultima_sincronizacion = NOW()
     WHERE id_solicitud = ? AND estado <> 'Atendida'
  `;
  // "AND estado <> 'Atendida'": si la visita ya se registró, la Fundación no puede revivir la solicitud
  await pool.query(sql, [
    datos.estado, datos.fecha_cita, datos.especialista_nombre, datos.id_especialista, datos.motivo_rechazo,
    datos.desasignar ? 1 : 0, id
  ]);
}

async function asignarEnfermero(id, idEnfermero) {
  const sql = `UPDATE tbl_solicitudes_referencia SET id_enfermero_asignado = ? WHERE id_solicitud = ?`;
  await pool.query(sql, [idEnfermero, id]);
}

// Enfermeros que se pueden asignar a una cita.
// "Enfermero" = usuario activo cuyo rol tenga el permiso solicitudes:ver_asignadas (no el rol
// de sistema). Y se descarta a quien ya tenga otra cita a menos de 2 horas de esta.
async function listarEnfermerosDisponibles(idSolicitud, fechaCitaSql) {
  const sql = `
    SELECT DISTINCT u.id_usuario, CONCAT_WS(' ', u.nombre1, u.apellido1) AS nombre
    FROM tbl_usuarios u
    JOIN tbl_roles r ON r.id_rol = u.id_rol AND r.es_sistema = 0
    JOIN tbl_roles_permisos rp ON rp.id_rol = r.id_rol
    JOIN tbl_permisos p ON p.id_permiso = rp.id_permiso AND p.clave = 'solicitudes:ver_asignadas'
    WHERE u.estado = 1
      AND NOT EXISTS (
        SELECT 1
        FROM tbl_solicitudes_referencia s
        WHERE s.id_enfermero_asignado = u.id_usuario
          AND s.id_solicitud <> ?
          AND s.estado IN ('Programada', 'Reprogramada')
          AND s.fecha_cita IS NOT NULL
          AND ABS(TIMESTAMPDIFF(MINUTE, s.fecha_cita, ?)) < 120
      )
    ORDER BY nombre
  `;
  const [filas] = await pool.query(sql, [idSolicitud, fechaCitaSql]);
  return filas;
}

// Las solicitudes que hay que revisar con la Fundación (las enviadas y las que no se pudieron enviar)
async function listarParaSincronizar() {
  const sql = `
    SELECT id_solicitud, codigo_fundacion
    FROM tbl_solicitudes_referencia
    WHERE estado IN (?)
    ORDER BY id_solicitud
  `;
  const [filas] = await pool.query(sql, [ESTADOS_ACTIVOS]);
  return filas;
}

// Solicitudes ya atendidas cuya Fundación todavía no fue avisada
async function listarAtendidasSinNotificar() {
  const sql = `
    SELECT id_solicitud, codigo_fundacion
    FROM tbl_solicitudes_referencia
    WHERE estado = 'Atendida' AND atendida_notificada = 0 AND codigo_fundacion IS NOT NULL
    ORDER BY id_solicitud
  `;
  const [filas] = await pool.query(sql);
  return filas;
}

async function marcarAtendidaNotificada(id) {
  await pool.query(`UPDATE tbl_solicitudes_referencia SET atendida_notificada = 1 WHERE id_solicitud = ?`, [id]);
}

module.exports = {
  listarAtendidasSinNotificar, marcarAtendidaNotificada,
  ESTADOS_ACTIVOS,
  listar, buscarPorId, crear, marcarPublicada, aplicarDeFundacion,
  asignarEnfermero, listarEnfermerosDisponibles, listarParaSincronizar
};
