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
  const lines = [title, '', columns.map((column) => column.header).join(' | ')];
  rows.forEach((row) => lines.push(columns.map((column) => value(row[column.key])).join(' | ')));
  if (!rows.length) lines.push('No hay datos para exportar.');

  const pdf = createSimplePdf(lines);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.end(pdf);
}

function createSimplePdf(lines) {
  const objects = [];
  const content = buildPdfContent(lines);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => pdf += `${String(offset).padStart(10, '0')} 00000 n \n`);
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function buildPdfContent(lines) {
  const visibleLines = lines.flatMap((line) => splitLine(String(line), 150)).slice(0, 32);
  const text = visibleLines.map((line, index) => `BT /F1 ${index === 0 ? 16 : 8} Tf 32 ${560 - index * 16} Td (${escapePdf(line)}) Tj ET`).join('\n');
  return text;
}

function splitLine(line, size) {
  const chunks = [];
  for (let index = 0; index < line.length; index += size) chunks.push(line.slice(index, index + size));
  return chunks.length ? chunks : [''];
}

function value(input) {
  return input === undefined || input === null || input === '' ? '-' : String(input);
}

function escapeHtml(input) {
  return String(input).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapePdf(input) {
  return String(input).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '\\$&');
}
