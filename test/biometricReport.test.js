import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mapPunches, parseBiometricReport, parsePunches, suggestMatches } from '../src/biometricReport.js';

async function buildReport() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Att. record report');

  sheet.getCell('A1').value = 'Att. Record Report';
  sheet.getCell('A2').value = 'Statistics Date:2026-11-01 ~ 2026-11-30    Create Date:2026-11-11';

  // Fila 3: numero de dia (con dia de semana entre parentesis) en cada columna.
  for (let day = 1; day <= 30; day += 1) {
    sheet.getRow(3).getCell(day).value = `${day}\n(${((day - 1) % 7) + 1})`;
  }

  // Trabajador 1: dia 2 con 2 marcas, dia 3 con 4 marcas + salida duplicada,
  // dia 4 con una sola marca y dia 8 sin marcas.
  sheet.getRow(4).getCell(1).value = 'ID.: 1       Name: LUCAS CARLOS    Dept.Name: PUNTO PAS';
  sheet.getRow(5).getCell(2).value = '06:53\n12:11';
  sheet.getRow(5).getCell(3).value = '06:56\n14:42\n15:40\n18:01\n18:01';
  sheet.getRow(5).getCell(4).value = '06:57';

  // Trabajador 2: dia 1 con 4 marcas y dia 2 con 3 marcas.
  sheet.getRow(6).getCell(1).value = 'ID.: 2       Name: ARROYO MARTHA    Dept.Name: PUNTO PAS';
  sheet.getRow(7).getCell(1).value = '06:50\n12:00\n13:05\n18:05';
  sheet.getRow(7).getCell(2).value = '06:55\n12:10\n13:00';

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('interpreta el reporte del biometrico y mapea las marcas', async () => {
  const buffer = await buildReport();
  const report = await parseBiometricReport(buffer);

  assert.deepEqual(report.range, { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(report.workers.length, 2);
  assert.equal(report.workers[0].excel_id, '1');
  assert.equal(report.workers[0].excel_name, 'LUCAS CARLOS');
  assert.equal(report.workers[0].dept, 'PUNTO PAS');

  const [lucas, arroyo] = report.workers;
  assert.deepEqual(lucas.days.map((day) => day.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(lucas.days[0], {
    date: '2026-11-02', entry_time: '06:53', lunch_out: '12:11', lunch_in: '', exit_time: '', punch_count: 2
  });
  assert.deepEqual(lucas.days[1], {
    date: '2026-11-03', entry_time: '06:56', lunch_out: '14:42', lunch_in: '15:40', exit_time: '18:01', punch_count: 4
  });
  assert.deepEqual(lucas.days[2], {
    date: '2026-11-04', entry_time: '06:57', lunch_out: '', lunch_in: '', exit_time: '', punch_count: 1
  });
  assert.equal(lucas.days.some((day) => day.date === '2026-11-08'), false);

  assert.deepEqual(arroyo.days[0], {
    date: '2026-11-01', entry_time: '06:50', lunch_out: '12:00', lunch_in: '13:05', exit_time: '18:05', punch_count: 4
  });
  assert.deepEqual(arroyo.days[1], {
    date: '2026-11-02', entry_time: '06:55', lunch_out: '12:10', lunch_in: '13:00', exit_time: '', punch_count: 3
  });
});

test('normaliza horas y descarta marcas invalidas o repetidas', () => {
  assert.deepEqual(parsePunches('6:53\n12:11'), ['06:53', '12:11']);
  assert.deepEqual(parsePunches('06:53\n06:53\n18:01\n18:01'), ['06:53', '18:01']);
  assert.deepEqual(parsePunches('24:00'), []);
  assert.deepEqual(parsePunches('00:00'), []);
  assert.deepEqual(parsePunches('texto sin horas'), []);
  assert.deepEqual(parsePunches(0.5), ['12:00']);

  assert.equal(mapPunches(['07:00']).exit_time, '');
  assert.equal(mapPunches(['07:00', '18:00']).exit_time, '18:00');
  // Dos marcas antes de las 15:00: la segunda es salida de almuerzo, no salida del dia.
  assert.deepEqual(mapPunches(['06:53', '12:11']), {
    entry_time: '06:53', lunch_out: '12:11', lunch_in: '', exit_time: '', punch_count: 2
  });
  assert.equal(mapPunches(['06:59', '14:59']).lunch_out, '14:59');
  assert.equal(mapPunches(['06:59', '15:00']).exit_time, '15:00');
  assert.equal(mapPunches(['07:00', '12:00', '13:00']).lunch_in, '13:00');
  assert.equal(mapPunches(['07:00', '12:00', '13:00', '18:00']).exit_time, '18:00');
});

test('interpreta un reporte de pocos dias (rango corto)', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Portada').getCell('A1').value = 'Reporte';
  const sheet = workbook.addWorksheet('Reporte');
  sheet.getCell('A1').value = 'Att. Record Report';
  sheet.getCell('A2').value = 'Statistics Date:2026-11-12 ~ 2026-11-13    Create Date:2026-11-14';
  sheet.getRow(3).getCell(1).value = '12\n(4)';
  sheet.getRow(3).getCell(2).value = '13\n(5)';
  sheet.getRow(4).getCell(1).value = 'ID.: 1       Name: LUCAS CARLOS    Dept.Name: PUNTO PAS';
  sheet.getRow(5).getCell(1).value = '06:55\n12:00';
  sheet.getRow(5).getCell(2).value = '06:57\n18:02';
  sheet.getRow(6).getCell(1).value = 'ID.: 2       Name: ARROYO MARTHA';
  sheet.getRow(7).getCell(1).value = '06:54\n12:01';

  const report = await parseBiometricReport(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.deepEqual(report.range, { start: '2026-11-12', end: '2026-11-13' });
  assert.equal(report.workers.length, 2);
  assert.deepEqual(report.workers[0].days.map((day) => day.date), ['2026-11-12', '2026-11-13']);
  assert.equal(report.workers[0].days[0].lunch_out, '12:00');
  assert.equal(report.workers[0].days[1].exit_time, '18:02');
  assert.equal(report.workers[1].excel_name, 'ARROYO MARTHA');
  assert.equal(report.workers[1].dept, '');
});

test('sugiere trabajadores aunque el Excel abrevie o invierta los nombres', () => {
  const candidates = [
    { id: 1, full_name: 'Lucas  Pico  Carlos Samuel' },
    { id: 2, full_name: 'Arroyo Baquerizo Martha Tomasa' },
    { id: 8, full_name: 'GARCIA PEREA MAGNA MISHELLE' },
    { id: 29, full_name: 'GRANDA BECERRA BRYAN' },
    { id: 27, full_name: 'GRANDA BECERRA BYRON ANDRE' },
    { id: 7, full_name: 'Dayana Ruano' },
    { id: 62, full_name: 'Davier Nazareno' },
    { id: 63, full_name: 'DAVIER NAZARENO' }
  ];

  const [lucas, garcia, bryan, ruano, davier, ausente] = suggestMatches(
    ['LUCAS CARLOS', 'GARCIA MSHELL', 'GRANDA BRYAN', 'RUANO DAYANA', 'DAVIER NAZARENO', 'EDIE CEVALLOS'],
    candidates
  );

  assert.equal(lucas.match, 'exact');
  assert.equal(lucas.worker_id, '1');
  assert.equal(garcia.match, 'probable');
  assert.equal(garcia.worker_id, '8');
  assert.equal(bryan.worker_id, '29');
  assert.equal(ruano.worker_id, '7');
  assert.equal(davier.match, 'ambiguous');
  assert.equal(davier.worker_id, null);
  assert.deepEqual(davier.alternatives.sort(), ['62', '63']);
  assert.equal(ausente.match, 'none');
});
