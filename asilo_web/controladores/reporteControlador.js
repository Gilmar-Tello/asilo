const reporteModelo = require('../modelos/reporteModelo');
const exportador = require('../servicios/exportadorReportes');
const { hoy, leerFecha, mesActual } = require('../utilidades/dinero');

const base = (req, titulo) => ({ titulo, usuario: req.session.usuario, rol: req.session.rol });
const aTextoFecha = (iso) => iso.split('-').reverse().join('/');   // 2026-10-01 -> 01/10/2026

// Catálogo de reportes (CU-08, paso 2)
exports.indice = (req, res) => {
  res.render('reportes/indice', { ...base(req, 'Reportes e informes'), reportes: reporteModelo.CATALOGO });
};

// Lee los filtros de la URL. La primera vez que se abre (sin desde/hasta en la URL) usa el rango inicial del reporte.
function leerFiltros(reporte, query) {
  let desde = null;
  let hasta = null;

  if (!('desde' in query) && !('hasta' in query)) {
    if (reporte.rangoInicial === 'mes') ({ desde, hasta } = mesActual());
  } else {
    desde = leerFecha(query.desde);
    hasta = leerFecha(query.hasta);
    if (desde && !hasta) hasta = hoy();             // "desde el 1 de enero" -> hasta hoy
    if (hasta && !desde) desde = '2000-01-01';      // "hasta el 30 de junio" -> desde el principio
    if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  }

  const id = parseInt(query.interno, 10);
  return { desde, hasta, idInterno: reporte.interno && id > 0 ? id : null };
}

function textoFiltros(f, nombreInterno) {
  const partes = [f.desde ? `Del ${aTextoFecha(f.desde)} al ${aTextoFecha(f.hasta)}` : 'Todas las fechas'];
  if (nombreInterno) partes.push(`Interno: ${nombreInterno}`);
  return partes.join(' · ');
}

// Prepara las celdas para la tabla de la pantalla (ya con formato Q y alineación)
function paraPantalla(datos) {
  return {
    resumen: datos.resumen.map((r) => ({ ...r, texto: exportador.formato(r.valor, r.tipo) })),
    secciones: datos.secciones.map((s) => ({
      ...s,
      encabezados: s.columnas.map((c) => ({ titulo: c.titulo, derecha: c.tipo !== 'texto' })),
      celdas: s.filas.map((f) => s.columnas.map((c) => ({ texto: exportador.formato(f[c.campo], c.tipo), derecha: c.tipo !== 'texto' }))),
      pie: s.totales && s.filas.length
        ? s.columnas.map((c, k) => ({
          texto: k === 0 ? 'TOTAL' : (c.campo in s.totales ? exportador.formato(s.totales[c.campo], c.tipo) : ''),
          derecha: c.tipo !== 'texto'
        }))
        : null,
      numColumnas: s.columnas.length
    }))
  };
}

// Un reporte: en pantalla, en PDF o en Excel (CU-08, pasos 3 a 5)
exports.ver = async (req, res) => {
  try {
    const reporte = reporteModelo.buscar(req.params.clave);
    if (!reporte) return res.redirect('/reportes');

    const filtros = leerFiltros(reporte, req.query);
    const nombreInterno = filtros.idInterno ? await reporteModelo.nombreInterno(filtros.idInterno) : null;
    if (filtros.idInterno && !nombreInterno) filtros.idInterno = null;   // id inventado en la URL

    const formato = ['pdf', 'excel'].includes(req.query.formato) ? req.query.formato : 'pantalla';
    const pantalla = {
      ...base(req, reporte.titulo),
      reporte,
      desde: filtros.desde || '',
      hasta: filtros.hasta || '',
      idInterno: filtros.idInterno || '',
      nombreInterno: nombreInterno || '',
      hoy: hoy(),
      conInterno: Boolean(reporte.interno),
      internoRequerido: reporte.interno === 'requerido'
    };

    // El historial necesita saber de quién es
    if (reporte.interno === 'requerido' && !filtros.idInterno) {
      return res.render('reportes/ver', {
        ...pantalla,
        aviso: 'Busca y elige al interno para generar este reporte.'
      });
    }

    const datos = await reporte.generar(filtros);
    if (!datos) return res.render('reportes/ver', { ...pantalla, aviso: 'El interno no existe.' });

    const meta = {
      clave: reporte.clave,
      titulo: reporte.titulo,
      filtros: textoFiltros(filtros, nombreInterno),
      usuario: req.session.nombre || req.session.usuario
    };

    if (formato === 'pdf') return exportador.aPdf(res, meta, datos);
    if (formato === 'excel') return await exportador.aExcel(res, meta, datos);

    res.render('reportes/ver', { ...pantalla, filtrosTexto: meta.filtros, ...paraPantalla(datos), generado: true });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.send('Error al generar el reporte');
  }
};
