const pool = require('../config/baseDatos');

// PLANTILLAS Y BITÁCORA DE CORREOS (CU-09)

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;
const ESTADOS = ['Enviado', 'Pendiente', 'Sin correo', 'Fallido', 'Enviando'];

// ===== Plantillas =====
async function plantillas() {
  const [filas] = await pool.query(
    `SELECT p.*, DATE_FORMAT(p.fecha_modificacion, '%d/%m/%Y %H:%i') AS modificada
       FROM tbl_plantillas_correo p ORDER BY p.id_plantilla`
  );
  return filas;
}

async function plantilla(clave) {
  const [[p]] = await pool.query(`SELECT * FROM tbl_plantillas_correo WHERE clave = ?`, [clave]);
  return p || null;
}

async function plantillaPorId(id) {
  const [[p]] = await pool.query(`SELECT * FROM tbl_plantillas_correo WHERE id_plantilla = ?`, [id]);
  return p || null;
}

async function guardarPlantilla(id, { asunto, cuerpo, activa }) {
  const [r] = await pool.query(
    `UPDATE tbl_plantillas_correo SET asunto = ?, cuerpo = ?, activa = ?, fecha_modificacion = NOW() WHERE id_plantilla = ?`,
    [asunto, cuerpo, activa ? 1 : 0, id]
  );
  return r.affectedRows;
}

// ===== Destinatario =====
// El interno y SU familiar responsable actual
async function datosInterno(idInterno) {
  const [[d]] = await pool.query(
    `SELECT i.id_interno, ${NOMBRE_INTERNO} AS interno, f.id_familiar, f.nombre_completo AS familiar, f.correo_electronico AS correo
       FROM tbl_internos i JOIN tbl_familiares_responsables f ON f.id_familiar = i.id_familiar
      WHERE i.id_interno = ?`,
    [idInterno]
  );
  return d || null;
}

async function datosFamiliar(idFamiliar) {
  const [[f]] = await pool.query(
    `SELECT id_familiar, nombre_completo AS familiar, correo_electronico AS correo FROM tbl_familiares_responsables WHERE id_familiar = ?`,
    [idFamiliar]
  );
  return f || null;
}

// ===== Bitácora =====
async function registrar(c) {
  const [r] = await pool.query(
    `INSERT INTO tbl_bitacora_correos (evento, id_interno, id_familiar, destinatario, asunto, cuerpo, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [c.evento, c.id_interno, c.id_familiar, c.destinatario, c.asunto, c.cuerpo, c.estado]
  );
  return r.insertId;
}

async function buscar(id) {
  const [[c]] = await pool.query(`SELECT * FROM tbl_bitacora_correos WHERE id_correo = ?`, [id]);
  return c || null;
}

// "Toma" el correo para enviarlo: si dos procesos lo intentan a la vez, solo uno lo consigue
async function tomar(id) {
  const [r] = await pool.query(
    `UPDATE tbl_bitacora_correos SET estado = 'Enviando', fecha_ultimo_intento = NOW()
      WHERE id_correo = ? AND estado = 'Pendiente'`,
    [id]
  );
  return r.affectedRows === 1;
}

async function marcarEnviado(id) {
  await pool.query(
    `UPDATE tbl_bitacora_correos SET estado = 'Enviado', fecha_envio = NOW(), intentos = intentos + 1, ultimo_error = NULL WHERE id_correo = ?`,
    [id]
  );
}

// Falló: suma el intento (si cuenta) y, si se agotaron, queda "Fallido"
async function marcarError(id, mensaje, cuentaIntento, maxIntentos) {
  await pool.query(
    `UPDATE tbl_bitacora_correos
        SET intentos = intentos + ?,
            estado = IF(intentos >= ?, 'Fallido', 'Pendiente'),
            ultimo_error = ?
      WHERE id_correo = ?`,
    [cuentaIntento ? 1 : 0, maxIntentos, String(mensaje).slice(0, 255), id]
  );
}

// Para la vuelta automática: suelta los que quedaron "Enviando" (el servidor se apagó a medio envío)
// y pone en "Pendiente" los "Sin correo" cuyo familiar ya registró un correo (RN4)
async function prepararReintentos(esCorreoValido) {
  await pool.query(
    `UPDATE tbl_bitacora_correos SET estado = 'Pendiente'
      WHERE estado = 'Enviando' AND fecha_ultimo_intento < NOW() - INTERVAL 10 MINUTE`
  );

  const [sinCorreo] = await pool.query(
    `SELECT b.id_correo, f.correo_electronico AS correo
       FROM tbl_bitacora_correos b JOIN tbl_familiares_responsables f ON f.id_familiar = b.id_familiar
      WHERE b.estado = 'Sin correo'`
  );
  for (const s of sinCorreo) {
    if (esCorreoValido(s.correo)) {
      await pool.query(
        `UPDATE tbl_bitacora_correos SET destinatario = ?, estado = 'Pendiente' WHERE id_correo = ? AND estado = 'Sin correo'`,
        [s.correo, s.id_correo]
      );
    }
  }
}

async function pendientes(maxIntentos, limite) {
  const [filas] = await pool.query(
    `SELECT id_correo FROM tbl_bitacora_correos WHERE estado = 'Pendiente' AND intentos < ? ORDER BY id_correo LIMIT ?`,
    [maxIntentos, limite]
  );
  return filas.map((f) => f.id_correo);
}

// Reintento a mano: vuelve a leer el correo actual del familiar y empieza de cero los intentos
async function reiniciar(id, correo) {
  const [r] = await pool.query(
    `UPDATE tbl_bitacora_correos
        SET destinatario = ?, estado = IF(? IS NULL, 'Sin correo', 'Pendiente'), intentos = 0, ultimo_error = NULL
      WHERE id_correo = ? AND estado IN ('Pendiente', 'Sin correo', 'Fallido')`,
    [correo, correo, id]
  );
  return r.affectedRows === 1;
}

// Listado con filtros (estado, texto, rango de fechas)
async function listar({ estado, busqueda, desde, hasta }) {
  let sql = `
    SELECT b.id_correo, b.evento, b.destinatario, b.asunto, b.cuerpo, b.estado, b.intentos, b.ultimo_error,
           DATE_FORMAT(b.fecha_creacion, '%d/%m/%Y %H:%i') AS creado, DATE_FORMAT(b.fecha_envio, '%d/%m/%Y %H:%i') AS enviado,
           COALESCE(p.nombre, b.evento) AS evento_nombre, f.nombre_completo AS familiar, ${NOMBRE_INTERNO} AS interno
      FROM tbl_bitacora_correos b
      LEFT JOIN tbl_plantillas_correo p ON p.clave = b.evento
      LEFT JOIN tbl_familiares_responsables f ON f.id_familiar = b.id_familiar
      LEFT JOIN tbl_internos i ON i.id_interno = b.id_interno
     WHERE 1 = 1`;
  const valores = [];
  if (estado) { sql += ` AND b.estado = ?`; valores.push(estado); }
  if (busqueda) {
    sql += ` AND (f.nombre_completo LIKE ? OR ${NOMBRE_INTERNO} LIKE ? OR b.destinatario LIKE ? OR b.asunto LIKE ?)`;
    valores.push(...Array(4).fill(`%${busqueda}%`));
  }
  if (desde && hasta) { sql += ` AND DATE(b.fecha_creacion) BETWEEN ? AND ?`; valores.push(desde, hasta); }
  sql += ` ORDER BY b.id_correo DESC LIMIT 300`;
  const [filas] = await pool.query(sql, valores);
  return filas;
}

async function conteo() {
  const [filas] = await pool.query(`SELECT estado, COUNT(*) AS cantidad FROM tbl_bitacora_correos GROUP BY estado`);
  return Object.fromEntries(filas.map((f) => [f.estado, f.cantidad]));
}

module.exports = {
  ESTADOS, plantillas, plantilla, plantillaPorId, guardarPlantilla, datosInterno, datosFamiliar,
  registrar, buscar, tomar, marcarEnviado, marcarError, prepararReintentos, pendientes, reiniciar, listar, conteo
};
