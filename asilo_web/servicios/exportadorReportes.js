const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// LAS "IMPRESORAS" DE LOS REPORTES
// Reciben el reporte ya armado ({ resumen, secciones }) y lo convierten en PDF (PDFKit) o Excel (ExcelJS).
// No consultan la base de datos: solo dibujan lo que les llega.

const INSTITUCION = 'Asilo de Ancianos Cabeza de Algodón';

// Q 1,234.50
function dinero(valor) {
  const n = Number(valor || 0);
  return 'Q ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formato(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return tipo === 'dinero' ? dinero(0) : '';
  if (tipo === 'dinero') return dinero(valor);
  if (tipo === 'numero') return String(Number(valor));
  return String(valor);
}

function ahora() {
  const f = new Date();
  const d = (n) => String(n).padStart(2, '0');
  return `${d(f.getDate())}/${d(f.getMonth() + 1)}/${f.getFullYear()} ${d(f.getHours())}:${d(f.getMinutes())}`;
}

// Nombre del archivo: reporte-costos-2026-10-22.pdf
function nombreArchivo(clave, extension) {
  const f = new Date();
  const d = (n) => String(n).padStart(2, '0');
  return `reporte-${clave}-${f.getFullYear()}-${d(f.getMonth() + 1)}-${d(f.getDate())}.${extension}`;
}

// ===================== PDF =====================
// meta: { titulo, filtros (texto), usuario }
function aPdf(res, meta, datos) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(meta.clave, 'pdf')}"`);
  doc.pipe(res);

  const izq = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const abajo = () => doc.page.height - doc.page.margins.bottom - 20;   // deja lugar al pie de página

  // Encabezado
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#1f3b57').text(INSTITUCION, izq, doc.y);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(meta.titulo);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${meta.filtros} · Generado el ${ahora()} por ${meta.usuario}`);
  doc.moveDown(0.6);

  // Resumen: tarjetitas en una fila
  if (datos.resumen && datos.resumen.length) {
    const n = datos.resumen.length;
    const w = (ancho - (n - 1) * 6) / n;
    const y = doc.y;
    datos.resumen.forEach((r, k) => {
      const x = izq + k * (w + 6);
      doc.roundedRect(x, y, w, 38, 4).fillAndStroke('#f1f5f9', '#cbd5e1');
      doc.fillColor('#555').font('Helvetica').fontSize(7.5).text(r.etiqueta, x + 6, y + 5, { width: w - 12, height: 10, ellipsis: true });
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(formato(r.valor, r.tipo), x + 6, y + 18, { width: w - 12, height: 14, ellipsis: true });
    });
    doc.x = izq;
    doc.y = y + 48;
  }

  for (const s of datos.secciones) {
    const pesos = s.columnas.reduce((t, c) => t + (c.ancho || 1), 0);
    const anchos = s.columnas.map((c) => ((c.ancho || 1) / pesos) * ancho);

    // Dibuja una fila; devuelve false si no cupo (hay que saltar de página)
    const fila = (celdas, opciones) => {
      doc.font(opciones.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const alto = Math.max(...celdas.map((t, k) => doc.heightOfString(t, { width: anchos[k] - 6 }))) + 6;
      if (doc.y + alto > abajo()) return false;
      const y = doc.y;
      if (opciones.fondo) doc.rect(izq, y, ancho, alto).fill(opciones.fondo);
      let x = izq;
      celdas.forEach((t, k) => {
        doc.fillColor(opciones.color || '#000')
          .text(t, x + 3, y + 3, { width: anchos[k] - 6, align: s.columnas[k].tipo === 'texto' ? 'left' : 'right' });
        x += anchos[k];
      });
      doc.moveTo(izq, y + alto).lineTo(izq + ancho, y + alto).lineWidth(0.4).strokeColor('#d0d7de').stroke();
      doc.x = izq;
      doc.y = y + alto;
      return true;
    };

    const encabezado = () => fila(s.columnas.map((c) => c.titulo), { negrita: true, fondo: '#1f3b57', color: '#fff' });

    // Título de la sección (si no cabe con al menos una fila, pasa a la página siguiente)
    if (doc.y + 60 > abajo()) doc.addPage();
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1f3b57').text(s.titulo, izq, doc.y);
    doc.moveDown(0.2);
    encabezado();

    if (s.filas.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#777').text(s.vacio || 'Sin datos.', izq + 3, doc.y + 4);
      doc.moveDown(0.8);
      continue;
    }

    const filas = s.filas.map((f) => s.columnas.map((c) => formato(f[c.campo], c.tipo)));
    if (s.totales) {
      filas.push(s.columnas.map((c, k) => (k === 0 ? 'TOTAL' : (c.campo in s.totales ? formato(s.totales[c.campo], c.tipo) : ''))));
    }

    filas.forEach((celdas, k) => {
      const esTotal = s.totales && k === filas.length - 1;
      const op = { negrita: esTotal, fondo: esTotal ? '#e2e8f0' : (k % 2 ? '#f8fafc' : null) };
      if (!fila(celdas, op)) {
        doc.addPage();
        encabezado();   // en la página nueva se repite el encabezado de la tabla
        fila(celdas, op);
      }
    });
    doc.moveDown(0.6);
  }

  // Pie: número de página en todas
  const paginas = doc.bufferedPageRange();
  for (let k = 0; k < paginas.count; k++) {
    doc.switchToPage(k);
    const y = doc.page.height - doc.page.margins.bottom - 10;
    doc.font('Helvetica').fontSize(7.5).fillColor('#777')
      .text(`${INSTITUCION} · ${meta.titulo} · Página ${k + 1} de ${paginas.count}`, izq, y, { width: ancho, align: 'center', lineBreak: false });
  }

  doc.end();
}

// ===================== EXCEL =====================
// Una hoja con el encabezado, el resumen y cada sección una debajo de otra.
// Los importes van como NÚMEROS (con formato Q), para que en Excel se puedan sumar y filtrar.
async function aExcel(res, meta, datos) {
  const libro = new ExcelJS.Workbook();
  libro.creator = INSTITUCION;
  libro.created = new Date();
  const hoja = libro.addWorksheet('Reporte', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });

  const maxColumnas = Math.max(2, ...datos.secciones.map((s) => s.columnas.length));
  const FORMATO_Q = '"Q" #,##0.00';
  const borde = { style: 'thin', color: { argb: 'FFD0D7DE' } };

  hoja.addRow([INSTITUCION]).font = { bold: true, size: 14, color: { argb: 'FF1F3B57' } };
  hoja.addRow([meta.titulo]).font = { bold: true, size: 12 };
  hoja.addRow([`${meta.filtros} · Generado el ${ahora()} por ${meta.usuario}`]).font = { italic: true, color: { argb: 'FF555555' } };
  hoja.addRow([]);

  for (const r of datos.resumen || []) {
    const fila = hoja.addRow([r.etiqueta, r.tipo === 'texto' ? String(r.valor) : Number(r.valor)]);
    fila.getCell(1).font = { bold: true };
    if (r.tipo === 'dinero') fila.getCell(2).numFmt = FORMATO_Q;
  }

  for (const s of datos.secciones) {
    hoja.addRow([]);
    hoja.addRow([s.titulo]).font = { bold: true, size: 12, color: { argb: 'FF1F3B57' } };

    const enc = hoja.addRow(s.columnas.map((c) => c.titulo));
    enc.eachCell((celda) => {
      celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B57' } };
      celda.border = { top: borde, bottom: borde, left: borde, right: borde };
    });

    if (s.filas.length === 0) {
      hoja.addRow([s.vacio || 'Sin datos.']).font = { italic: true, color: { argb: 'FF777777' } };
      continue;
    }

    for (const f of s.filas) {
      const fila = hoja.addRow(s.columnas.map((c) => {
        const v = f[c.campo];
        if (c.tipo === 'texto') return v === null || v === undefined ? '' : String(v);
        return v === null || v === undefined || v === '' ? null : Number(v);
      }));
      s.columnas.forEach((c, k) => {
        const celda = fila.getCell(k + 1);
        if (c.tipo === 'dinero') celda.numFmt = FORMATO_Q;
        celda.alignment = { vertical: 'top', wrapText: c.tipo === 'texto' };
        celda.border = { bottom: borde };
      });
    }

    if (s.totales) {
      const fila = hoja.addRow(s.columnas.map((c, k) => (k === 0 ? 'TOTAL' : (c.campo in s.totales ? Number(s.totales[c.campo]) : null))));
      fila.font = { bold: true };
      s.columnas.forEach((c, k) => {
        const celda = fila.getCell(k + 1);
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        if (c.tipo === 'dinero') celda.numFmt = FORMATO_Q;
      });
    }
  }

  // Ancho de columnas: según el texto más largo (con tope, para que no queden gigantes)
  for (let k = 1; k <= maxColumnas; k++) {
    let largo = 10;
    hoja.getColumn(k).eachCell({ includeEmpty: false }, (celda, numeroFila) => {
      if (numeroFila <= 3) return;   // el título largo no cuenta
      const texto = celda.numFmt === FORMATO_Q ? formato(celda.value, 'dinero') : String(celda.value ?? '');
      largo = Math.max(largo, Math.min(texto.length + 2, 45));
    });
    hoja.getColumn(k).width = largo;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(meta.clave, 'xlsx')}"`);
  await libro.xlsx.write(res);
  res.end();
}

module.exports = { aPdf, aExcel, formato, dinero };
