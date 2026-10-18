const pool = require('../config/baseDatos');

// Datos de la visita con los nombres ya armados (fechas como texto, para no pelear con zonas horarias)
const SELECT_VISITA = `
  SELECT v.id_visita, v.id_solicitud, v.id_interno, v.id_especialista, v.estado, v.cerrada,
         DATE_FORMAT(v.fecha_cierre, '%d/%m/%Y %H:%i') AS fecha_cierre_texto,
         v.diagnostico, v.observaciones,
         v.costo_consulta, v.costo_examenes, v.costo_medicamentos,
         v.subtotal, v.descuento, v.total, v.estado_costo,
         DATE_FORMAT(v.fecha_visita, '%d/%m/%Y %H:%i') AS fecha_texto,
         CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS interno_nombre,
         TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
         CONCAT_WS(' ', u.nombre1, u.apellido1) AS especialista_nombre,
         e.nombre AS especialidad
  FROM tbl_visitas_medicas v
  JOIN tbl_internos i ON i.id_interno = v.id_interno
  JOIN tbl_usuarios u ON u.id_usuario = v.id_especialista
  LEFT JOIN tbl_especialidades e ON e.id_especialidad = u.id_especialidad
`;

// Agenda del especialista: SUS citas programadas (RN7). El filtro va en el SQL, no en la pantalla.
// Cada cita trae el id de su visita si ya hay un borrador empezado.
async function agenda(idEspecialista) {
  const sql = `
    SELECT s.id_solicitud, s.estado, s.especialidad_requerida,
           DATE_FORMAT(s.fecha_cita, '%d/%m/%Y %H:%i') AS fecha_cita_texto,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS interno_nombre,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
           (SELECT v.id_visita FROM tbl_visitas_medicas v
             WHERE v.id_solicitud = s.id_solicitud AND v.estado = 'Borrador'
             ORDER BY v.id_visita DESC LIMIT 1) AS id_borrador
    FROM tbl_solicitudes_referencia s
    JOIN tbl_internos i ON i.id_interno = s.id_interno
    WHERE s.id_especialista = ? AND s.estado IN ('Programada', 'Reprogramada')
    ORDER BY s.fecha_cita, s.id_solicitud
  `;
  const [filas] = await pool.query(sql, [idEspecialista]);
  return filas;
}

// La cita de este especialista (si no es suya o no está programada, devuelve undefined: RN7)
async function buscarCita(idSolicitud, idEspecialista) {
  const sql = `
    SELECT s.id_solicitud, s.id_interno, s.estado, s.evaluacion_inicial, s.especialidad_requerida,
           DATE_FORMAT(s.fecha_cita, '%d/%m/%Y %H:%i') AS fecha_cita_texto,
           CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) AS interno_nombre,
           TIMESTAMPDIFF(YEAR, i.fecha_nacimiento, CURDATE()) AS interno_edad,
           i.sexo AS interno_sexo
    FROM tbl_solicitudes_referencia s
    JOIN tbl_internos i ON i.id_interno = s.id_interno
    WHERE s.id_solicitud = ? AND s.id_especialista = ? AND s.estado IN ('Programada', 'Reprogramada')
  `;
  const [filas] = await pool.query(sql, [idSolicitud, idEspecialista]);
  return filas[0];
}

async function buscarBorrador(idSolicitud) {
  const [filas] = await pool.query(
    SELECT_VISITA + ` WHERE v.id_solicitud = ? AND v.estado = 'Borrador' ORDER BY v.id_visita DESC LIMIT 1`,
    [idSolicitud]
  );
  return filas[0];
}

async function buscarPorId(id) {
  const [filas] = await pool.query(SELECT_VISITA + ` WHERE v.id_visita = ?`, [id]);
  return filas[0];
}

async function listarExamenes(idVisita) {
  const [filas] = await pool.query(
    `SELECT id_examen, nombre_examen, costo_estimado, costo_real, estado, resultado, motivo_anulacion, id_examen_origen, id_seguimiento,
            DATE_FORMAT(fecha_resultado, '%d/%m/%Y %H:%i') AS fecha_resultado_texto
     FROM tbl_examenes_laboratorio WHERE id_visita = ? ORDER BY id_examen`,
    [idVisita]
  );
  return filas;
}

async function listarRecetas(idVisita) {
  const [filas] = await pool.query(
    `SELECT id_receta, medicamento, area_aplicacion, cantidad, tiempo_aplicacion, cantidad_despachada, sin_existencia, id_seguimiento
     FROM tbl_recetas_visita WHERE id_visita = ? ORDER BY id_receta`,
    [idVisita]
  );
  return filas;
}

// Todas las visitas (para quien tiene visitas:ver). Busca por nombre del interno o diagnóstico.
async function listar(busqueda) {
  let sql = SELECT_VISITA;
  const valores = [];

  if (busqueda) {
    sql += ` WHERE CONCAT_WS(' ', i.nombre1, i.nombre2, i.apellido1, i.apellido2, i.apellido_casada) LIKE ?
                OR v.diagnostico LIKE ?`;
    const patron = `%${busqueda}%`;
    valores.push(patron, patron);
  }

  sql += ` ORDER BY v.fecha_visita DESC, v.id_visita DESC LIMIT 200`;

  const [filas] = await pool.query(sql, valores);
  return filas;
}

// Historial clínico (pasos 3 y 4 del CU-04): las visitas ya registradas del interno,
// con sus exámenes y recetas. Las que aún son borrador o "No asistió" no cuentan como historial.
async function historialDelInterno(idInterno, excluirIdVisita) {
  const [visitas] = await pool.query(
    SELECT_VISITA + ` WHERE v.id_interno = ? AND v.estado = 'Registrada' AND v.id_visita <> ?
                      ORDER BY v.fecha_visita DESC, v.id_visita DESC LIMIT 20`,
    [idInterno, excluirIdVisita || 0]
  );

  if (visitas.length === 0) {
    return [];
  }

  const ids = visitas.map((v) => v.id_visita);

  const [examenes] = await pool.query(
    `SELECT id_visita, nombre_examen, estado FROM tbl_examenes_laboratorio WHERE id_visita IN (?) ORDER BY id_examen`,
    [ids]
  );
  const [recetas] = await pool.query(
    `SELECT id_visita, medicamento, cantidad, tiempo_aplicacion FROM tbl_recetas_visita WHERE id_visita IN (?) ORDER BY id_receta`,
    [ids]
  );

  return visitas.map((v) => ({
    ...v,
    examenes: examenes.filter((x) => x.id_visita === v.id_visita),
    recetas: recetas.filter((x) => x.id_visita === v.id_visita)
  }));
}

// Guarda la visita en UNA transacción (o se guarda todo o nada):
//   - crea la visita o actualiza el borrador
//   - reemplaza sus exámenes y recetas (mientras es borrador no son registro clínico todavía)
//   - según 'estado': 'Borrador' | 'Registrada' (y entonces la solicitud pasa a "Atendida", RN3) | 'No asistió'
// Devuelve el id de la visita, o null si alguien más ya la cerró mientras tanto.
async function guardar(datos) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    let idVisita = datos.id_visita;

    if (idVisita) {
      // WHERE estado = 'Borrador': si ya se registró (otra pestaña, doble clic), no se pisa
      const [r] = await conexion.query(
        `UPDATE tbl_visitas_medicas
            SET diagnostico = ?, observaciones = ?, costo_consulta = ?, costo_examenes = ?,
                estado = ?, fecha_visita = NOW()
          WHERE id_visita = ? AND estado = 'Borrador'`,
        [datos.diagnostico, datos.observaciones, datos.costo_consulta, datos.costo_examenes,
         datos.estado, idVisita]
      );

      if (r.affectedRows === 0) {
        await conexion.rollback();
        return null;
      }

      await conexion.query(`DELETE FROM tbl_examenes_laboratorio WHERE id_visita = ?`, [idVisita]);
      await conexion.query(`DELETE FROM tbl_recetas_visita WHERE id_visita = ?`, [idVisita]);
    } else {
      const [r] = await conexion.query(
        `INSERT INTO tbl_visitas_medicas
           (id_solicitud, id_interno, id_especialista, diagnostico, observaciones,
            costo_consulta, costo_examenes, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [datos.id_solicitud, datos.id_interno, datos.id_especialista, datos.diagnostico,
         datos.observaciones, datos.costo_consulta, datos.costo_examenes, datos.estado]
      );
      idVisita = r.insertId;
    }

    for (const examen of datos.examenes) {
      await conexion.query(
        `INSERT INTO tbl_examenes_laboratorio (id_visita, nombre_examen, costo_estimado) VALUES (?, ?, ?)`,
        [idVisita, examen.nombre, examen.costo]
      );
    }

    for (const receta of datos.recetas) {
      await conexion.query(
        `INSERT INTO tbl_recetas_visita (id_visita, medicamento, area_aplicacion, cantidad, tiempo_aplicacion)
         VALUES (?, ?, ?, ?, ?)`,
        [idVisita, receta.medicamento, receta.area, receta.cantidad, receta.tiempo]
      );
    }

    // Confirmada: queda EN CURSO (cerrada = 0, espera resultados) o CERRADA. "No asistió" se cierra sola.
    if (datos.estado !== 'Borrador') {
      const cerrar = datos.estado === 'No asistió' || datos.cerrar ? 1 : 0;
      await conexion.query(
        `UPDATE tbl_visitas_medicas SET cerrada = ?, fecha_cierre = IF(? = 1, NOW(), NULL) WHERE id_visita = ?`,
        [cerrar, cerrar, idVisita]
      );
    }

    if (datos.estado === 'Registrada') {
      // La cita ya se atendió. El WHERE evita cerrar una solicitud que dejó de estar programada.
      const [s] = await conexion.query(
        `UPDATE tbl_solicitudes_referencia SET estado = 'Atendida'
          WHERE id_solicitud = ? AND estado IN ('Programada', 'Reprogramada')`,
        [datos.id_solicitud]
      );

      if (s.affectedRows === 0) {
        await conexion.rollback();
        return null;
      }

      // Con diagnóstico y con cargos por calcular (RN2). Sin nada que cobrar queda "Sin cargos".
      const hayCargos = datos.costo_consulta > 0 || datos.costo_examenes > 0;
      await conexion.query(
        `UPDATE tbl_visitas_medicas SET estado_costo = ? WHERE id_visita = ?`,
        [hayCargos ? 'Pendiente de cálculo' : 'Sin cargos', idVisita]
      );
    }

    await conexion.commit();
    return idVisita;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Guarda lo que devolvió el microservicio de costos
async function guardarCostos(idVisita, costos) {
  await pool.query(
    `UPDATE tbl_visitas_medicas
        SET subtotal = ?, descuento = ?, total = ?, estado_costo = 'Calculado'
      WHERE id_visita = ?`,
    [costos.subtotal, costos.descuento, costos.total, idVisita]
  );

  // RN9: si la visita YA se facturó, el cargo del familiar sigue al total nuevo (por ejemplo, el laboratorio
  // fijó el precio real o se despachó un medicamento después). RN10: si ya no cubre el total, vuelve a "Pendiente de Pago".
  const [r] = await pool.query(
    `UPDATE tbl_visitas_medicas
        SET monto_facturado = total,
            estado_cobro = IF(monto_pagado >= total, 'Cancelada', 'Pendiente de Pago'),
            fecha_cancelacion = IF(monto_pagado >= total, COALESCE(fecha_cancelacion, NOW()), NULL)
      WHERE id_visita = ? AND estado_cobro <> 'Sin facturar'`,
    [idVisita]
  );

  if (r.affectedRows > 0) {
    const [[v]] = await pool.query(`SELECT id_familiar_cobro FROM tbl_visitas_medicas WHERE id_visita = ?`, [idVisita]);
    await require('./cobroModelo').recalcularSaldo(pool, v.id_familiar_cobro);
  }
}

// Visitas registradas cuyo costo quedó "pendiente de cálculo" (FE-02): se reintentan solas
async function listarCostosPendientes() {
  const [filas] = await pool.query(
    `SELECT id_visita, costo_consulta, costo_examenes, costo_medicamentos
       FROM tbl_visitas_medicas
      WHERE estado = 'Registrada' AND estado_costo = 'Pendiente de cálculo'
      ORDER BY id_visita LIMIT 50`
  );
  return filas;
}

// Visitas EN CURSO de un especialista (confirmadas y sin cerrar), con cuántos exámenes esperan resultado
async function enCurso(idEspecialista) {
  const [filas] = await pool.query(
    SELECT_VISITA.replace('FROM tbl_visitas_medicas v', `,
         (SELECT COUNT(*) FROM tbl_examenes_laboratorio ex WHERE ex.id_visita = v.id_visita AND ex.estado = 'Ordenado') AS examenes_pendientes,
         (SELECT COUNT(*) FROM tbl_examenes_laboratorio ex WHERE ex.id_visita = v.id_visita AND ex.estado = 'Con resultado') AS examenes_con_resultado
  FROM tbl_visitas_medicas v`) + `
     WHERE v.id_especialista = ? AND v.estado = 'Registrada' AND v.cerrada = 0
     ORDER BY v.fecha_visita`,
    [idEspecialista]
  );
  return filas;
}

async function seguimientos(idVisita) {
  const [filas] = await pool.query(
    `SELECT id_seguimiento, nota, DATE_FORMAT(fecha, '%d/%m/%Y %H:%i') AS fecha_texto
       FROM tbl_seguimientos_visita WHERE id_visita = ? ORDER BY fecha, id_seguimiento`,
    [idVisita]
  );
  return filas;
}

// Vuelve a sumar los exámenes de la visita (real si existe, aproximado si no) y la deja lista para recalcular
async function recalcularExamenes(conexion, idVisita) {
  const [[suma]] = await conexion.query(
    `SELECT COALESCE(SUM(COALESCE(costo_real, costo_estimado)), 0) AS total FROM tbl_examenes_laboratorio WHERE id_visita = ?`,
    [idVisita]
  );
  await conexion.query(
    `UPDATE tbl_visitas_medicas
        SET costo_examenes = ?,
            estado_costo = IF(costo_consulta + ? + costo_medicamentos > 0, 'Pendiente de cálculo', 'Sin cargos')
      WHERE id_visita = ?`,
    [suma.total, suma.total, idVisita]
  );
}

// SEGUIMIENTO de una visita en curso: una nota nueva con recetas y/o exámenes nuevos.
// No modifica nada de lo anterior (RN12): solo agrega. Devuelve el id, o null si la visita ya no está en curso.
async function agregarSeguimiento(idVisita, nota, examenes, recetas) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [[visita]] = await conexion.query(
      `SELECT id_visita FROM tbl_visitas_medicas WHERE id_visita = ? AND estado = 'Registrada' AND cerrada = 0 FOR UPDATE`,
      [idVisita]
    );

    if (!visita) {
      await conexion.rollback();
      return null;
    }

    const [r] = await conexion.query(
      `INSERT INTO tbl_seguimientos_visita (id_visita, nota) VALUES (?, ?)`,
      [idVisita, nota]
    );

    for (const examen of examenes) {
      await conexion.query(
        `INSERT INTO tbl_examenes_laboratorio (id_visita, nombre_examen, costo_estimado, id_seguimiento) VALUES (?, ?, ?, ?)`,
        [idVisita, examen.nombre, examen.costo, r.insertId]
      );
    }

    for (const receta of recetas) {
      await conexion.query(
        `INSERT INTO tbl_recetas_visita (id_visita, medicamento, area_aplicacion, cantidad, tiempo_aplicacion, id_seguimiento)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [idVisita, receta.medicamento, receta.area, receta.cantidad, receta.tiempo, r.insertId]
      );
    }

    if (examenes.length > 0) {
      await recalcularExamenes(conexion, idVisita);
    }

    await conexion.commit();
    return r.insertId;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

// Cierra una visita en curso. Devuelve cuántas filas cambió (0 = ya estaba cerrada).
async function cerrar(idVisita) {
  const [r] = await pool.query(
    `UPDATE tbl_visitas_medicas SET cerrada = 1, fecha_cierre = NOW()
      WHERE id_visita = ? AND estado = 'Registrada' AND cerrada = 0`,
    [idVisita]
  );
  return r.affectedRows;
}

module.exports = {
  enCurso, seguimientos, agregarSeguimiento, cerrar,
  agenda, buscarCita, buscarBorrador, buscarPorId, listarExamenes, listarRecetas,
  listar, historialDelInterno, guardar, guardarCostos, listarCostosPendientes
};
