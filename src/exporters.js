import PDFDocument from 'pdfkit';

export function sendExcel(res, filename, title, columns, rows) {
  const tableRows = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(value(row[column.key]))}</td>`).join('')}</tr>`).join('');
  const html = `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <h2>${escapeHtml(title)}</h2>
        <table border="1">
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows || `<tr><td colspan="${columns.length}">No hay datos para exportar.</td></tr>`}</tbody>
        </table>
      </body>
    </html>`;

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xls"`);
  res.send(html);
}

export function sendPdf(res, filename, title, columns, rows) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  doc.pipe(res);
  drawHeader(doc, title);
  drawTable(doc, columns, rows);
  drawFooter(doc);
  doc.end();
}

function value(input) {
  return input === undefined || input === null || input === '' ? '-' : String(input);
}

function escapeHtml(input) {
  return String(input).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function drawHeader(doc, title) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(left, 24, width, 54).fill('#10192d');
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('Control de Asistencia', left + 18, 38);
  doc.fontSize(9).font('Helvetica').fillColor('#d9e1f2').text(title, left + 18, 60);
  doc.fillColor('#172033').fontSize(8).text(`Generado: ${new Date().toLocaleString('es-EC')}`, left, 90, { align: 'right', width });
  doc.moveDown(2.2);
}

function drawTable(doc, columns, rows) {
  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const normalized = normalizeColumns(columns, tableWidth);
  let y = 112;
  drawTableHeader(doc, normalized, left, y);
  y += 28;

  if (!rows.length) {
    doc.fillColor('#68758d').fontSize(10).text('No hay datos para exportar.', left, y + 16, { width: tableWidth, align: 'center' });
    return;
  }

  rows.forEach((row, index) => {
    if (y > doc.page.height - 58) {
      drawFooter(doc);
      doc.addPage();
      drawHeader(doc, 'Continuacion');
      y = 112;
      drawTableHeader(doc, normalized, left, y);
      y += 28;
    }
    drawTableRow(doc, normalized, row, left, y, index);
    y += 28;
  });
}

function drawTableHeader(doc, columns, left, y) {
  let x = left;
  doc.rect(left, y, columns.reduce((sum, column) => sum + column.pdfWidth, 0), 26).fill('#2454d6');
  columns.forEach((column) => {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5).text(column.header.toUpperCase(), x + 4, y + 8, { width: column.pdfWidth - 8, height: 14, ellipsis: true });
    x += column.pdfWidth;
  });
}

function drawTableRow(doc, columns, row, left, y, index) {
  let x = left;
  const rowColor = index % 2 === 0 ? '#ffffff' : '#f6f8fc';
  doc.rect(left, y, columns.reduce((sum, column) => sum + column.pdfWidth, 0), 28).fill(rowColor).strokeColor('#e5eaf2').stroke();
  columns.forEach((column) => {
    doc.fillColor('#172033').font('Helvetica').fontSize(7).text(value(row[column.key]), x + 4, y + 7, { width: column.pdfWidth - 8, height: 16, ellipsis: true });
    doc.moveTo(x, y).lineTo(x, y + 28).strokeColor('#e5eaf2').stroke();
    x += column.pdfWidth;
  });
  doc.moveTo(x, y).lineTo(x, y + 28).strokeColor('#e5eaf2').stroke();
}

function drawFooter(doc) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.fontSize(7).fillColor('#68758d').text('Documento generado automaticamente por el sistema de Control de Asistencia.', doc.page.margins.left, doc.page.height - 28, { width, align: 'center' });
}

function normalizeColumns(columns, tableWidth) {
  const total = columns.reduce((sum, column) => sum + (column.width || 18), 0);
  return columns.map((column) => ({ ...column, pdfWidth: ((column.width || 18) / total) * tableWidth }));
}
