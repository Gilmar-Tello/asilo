const pool = require('../config/baseDatos');
const { texto } = require('../utilidades/texto');

// SUGERENCIAS para los buscadores (public/js/autocompletar.js). Devuelven poco (máximo 15) y en JSON:
//   [{ id, etiqueta, detalle, ...datos extra }]
// LIMIT: nunca se mandan cientos de filas al navegador; el usuario sigue escribiendo para acotar.

const LIMITE = 15;

function tienePermiso(res, clave) {
  return res.locals.rolEsSistema || res.locals.misPermisos.includes(clave);
}

// Lo que escribió el usuario (mínimo 2 letras), listo para LIKE
function patron(req) {
  const t = texto(req.query.q).slice(0, 60);
  return t.length >= 2 ? `%${t}%` : null;
}

const NOMBRE_INTERNO = `CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada)`;

// Internos por nombre o DPI. Activos; con ?todos=1 también los inactivos (solo quien administra internos)
exports.internos = async (req, res) => {
  try {
    const p = patron(req);
    if (!p) return res.json([]);

    const todos = req.query.todos === '1' && tienePermiso(res, 'internos:ver');

    const [filas] = await pool.query(
      `SELECT i.id_interno, i.dpi, i.estado, ${NOMBRE_INTERNO} AS nombre,
              TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS edad
         FROM tbl_internos i
        WHERE (${NOMBRE_INTERNO} LIKE ? OR i.dpi LIKE ?) ${todos ? '' : 'AND i.estado = 1'}
        ORDER BY i.apellido1, i.nombre1
        LIMIT ${LIMITE}`,
      [p, p]
    );

    res.json(filas.map((f) => ({
      id: f.id_interno,
      etiqueta: f.nombre,
      detalle: `DPI ${f.dpi} · ${f.edad} años${f.estado === 1 ? '' : ' · INACTIVO'}`
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

// Medicamentos del catálogo con lo DISPONIBLE (no vencido) y el precio. Con ?todos=1 también los desactivados.
exports.medicamentos = async (req, res) => {
  try {
    const p = patron(req);
    if (!p) return res.json([]);

    const todos = req.query.todos === '1' && tienePermiso(res, 'medicamentos:gestionar');

    const [filas] = await pool.query(
      `SELECT m.id_medicamento, m.nombre, m.presentacion, m.precio, m.estado,
              CAST(COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURDATE()
                                     THEN l.existencia END), 0) AS SIGNED) AS disponible
         FROM tbl_medicamentos m
         LEFT JOIN tbl_lotes_medicamento l ON l.id_medicamento = m.id_medicamento AND l.existencia > 0
        WHERE (m.nombre LIKE ? OR m.presentacion LIKE ?) ${todos ? '' : 'AND m.estado = 1'}
        GROUP BY m.id_medicamento
        ORDER BY m.nombre, m.presentacion
        LIMIT ${LIMITE}`,
      [p, p]
    );

    res.json(filas.map((f) => ({
      id: f.id_medicamento,
      etiqueta: `${f.nombre} ${f.presentacion}`.trim(),
      detalle: `Disponible ${f.disponible} · Q ${f.precio}${f.estado === 1 ? '' : ' · DESACTIVADO'}`,
      nombre: f.nombre,
      precio: f.precio,
      existencia: f.disponible
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

// Familiares responsables por nombre, DPI o correo (para la lista de familiares)
exports.familiares = async (req, res) => {
  try {
    const p = patron(req);
    if (!p) return res.json([]);

    const [filas] = await pool.query(
      `SELECT id_familiar, nombre_completo, dpi, estado
         FROM tbl_familiares_responsables
        WHERE nombre_completo LIKE ? OR dpi LIKE ? OR correo_electronico LIKE ?
        ORDER BY nombre_completo
        LIMIT ${LIMITE}`,
      [p, p, p]
    );

    res.json(filas.map((f) => ({
      id: f.id_familiar,
      etiqueta: f.nombre_completo,
      detalle: `DPI ${f.dpi}${f.estado === 1 ? '' : ' · INACTIVO'}`
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};
