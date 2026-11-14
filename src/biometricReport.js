// Interpreta el reporte Excel del biometrico (formato ZKTeco / "Att. record report").
//
// El archivo trae una hoja con esta forma:
//   fila 1: titulo "Att. Record Report"
//   fila 2: "Statistics Date:2026-11-01 ~ 2026-11-30   Create Date:..."
//   fila 3: numero de dia de cada columna, por ejemplo "1\n(7)" (dia 1, dia de semana 7)
//   fila 4: encabezado del trabajador "ID.: 1  Name: LUCAS CARLOS  Dept.Name: PUNTO PAS"
//   fila 5: marcas del trabajador separadas por saltos de linea (06:53, 12:11, ...)
//   fila 6..: el mismo par de filas para cada trabajador
//
// Aqui solo se interpreta el archivo: no se guarda nada. La vista previa y el
// guardado se hacen en las rutas /asistencia/biometrico/*.
import ExcelJS from 'exceljs';

export const BIOMETRIC_SHEET = 'Att. record report';

/**
 * Lee un archivo .xlsx del biometrico y devuelve los dias con marcas.
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {Promise<{sheet: string, range: {start: string, end: string}, days: string[], workers: Array}>}
 */
export async function parseBiometricReport(input) {
  if (!input || !input.byteLength) throw new Error('REPORTE_VACIO');
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('REPORTE_INVALIDO');
  }

  const sheet = pickSheet(workbook);
  if (!sheet) throw new Error('REPORTE_SIN_HOJAS');

  const range = findRange(sheet);
  if (!range) throw new Error('REPORTE_SIN_RANGO');

  const dayHeader = findDayHeader(sheet);
  if (!dayHeader) throw new Error('REPORTE_SIN_DIAS');

  const columns = mapDayColumns(dayHeader.columns, range);
  if (!columns.length) throw new Error('REPORTE_SIN_DIAS');

  const workers = [];
  for (let rowNumber = dayHeader.row + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const header = parseWorkerHeader(sheet.getRow(rowNumber).getCell(1).value);
    if (!header) continue;

    const timesRow = sheet.getRow(rowNumber + 1);
    const days = [];
    for (const column of columns) {
      const punches = parsePunches(timesRow.getCell(column.col).value);
      if (!punches.length) continue;
      days.push({ date: column.date, ...mapPunches(punches) });
    }

    if (days.length) {
      workers.push({ ...header, days });
    }
    // La fila siguiente siempre es la de marcas; se salta para no confundirla
    // con un encabezado de trabajador.
    rowNumber += 1;
  }

  if (!workers.length) throw new Error('REPORTE_SIN_TRABAJADORES');

  return {
    sheet: sheet.name,
    range,
    days: columns.map((column) => column.date),
    workers
  };
}

/* ------------------------------------------------------------------ */
/* Lectura de la hoja                                                  */
/* ------------------------------------------------------------------ */

function pickSheet(workbook) {
  const sheets = workbook.worksheets || [];
  const byName = sheets.find((sheet) => normalizeText(sheet.name) === normalizeText(BIOMETRIC_SHEET))
    || sheets.find((sheet) => /att\.?\s*record/i.test(sheet.name));
  if (byName) return byName;
  // Si la hoja del reporte tiene otro nombre, buscar la que realmente tenga
  // el rango de fechas y la fila de dias (a veces el libro trae una portada).
  const byLayout = sheets.find((sheet) => findRange(sheet) && findDayHeader(sheet));
  return byLayout || sheets[0];
}

function findRange(sheet) {
  const maxRow = Math.min(sheet.rowCount || 0, 20);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= Math.max(sheet.columnCount || 0, 1); column += 1) {
      const text = cellText(row.getCell(column).value);
      if (!text) continue;
      const match = /(\d{4})[-/](\d{2})[-/](\d{2})\s*(?:~|-|to|a|hasta)\s*(\d{4})[-/](\d{2})[-/](\d{2})/i.exec(text);
      if (match) {
        const start = `${match[1]}-${match[2]}-${match[3]}`;
        const end = `${match[4]}-${match[5]}-${match[6]}`;
        if (start <= end) return { start, end };
      }
    }
  }
  return null;
}

function findDayHeader(sheet) {
  const maxRow = Math.min(sheet.rowCount || 0, 30);
  const maxColumn = Math.max(sheet.columnCount || 0, 1);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const columns = [];
    for (let column = 1; column <= maxColumn; column += 1) {
      const day = parseDayNumber(row.getCell(column).value);
      if (day === null) continue;
      columns.push({ col: column, day });
    }
    const uniqueDays = new Set(columns.map((column) => column.day));
    // Un reporte puede ser de un solo dia o de pocos dias; no exigir 20 columnas.
    if (columns.length >= 1 && uniqueDays.size >= 1) {
      return { row: rowNumber, columns };
    }
  }
  return null;
}

function parseDayNumber(value) {
  const text = cellText(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const match = /^(\d{1,2})(?:\s*\([^)]*\))?$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

function mapDayColumns(dayColumns, range) {
  const start = splitIsoDate(range.start);
  const end = splitIsoDate(range.end);
  if (!start || !end) return [];
  const columns = [];
  for (const column of dayColumns) {
    const date = findDateForDay(column.day, start, end, range);
    if (date) columns.push({ ...column, date });
  }
  return columns;
}

function findDateForDay(day, start, end, range) {
  // Recorre hasta 24 meses desde el inicio para soportar rangos que cruzan de mes.
  const startIndex = start.year * 12 + (start.month - 1);
  for (let offset = 0; offset < 24; offset += 1) {
    const index = startIndex + offset;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    if (day > daysInMonth(year, month)) continue;
    const date = `${year}-${pad(month)}-${pad(day)}`;
    if (date > range.end) break;
    if (date >= range.start) return date;
  }
  return null;
}

function parseWorkerHeader(value) {
  const text = cellText(value);
  if (!text) return null;
  const match = /(?:ID|No)\.?\s*:?\s*(\d+)\s+Name\s*:\s*([\s\S]*?)(?:\s+Dept\.?\s*Name\s*:\s*([\s\S]*))?$/i.exec(text);
  if (!match) return null;
  return {
    excel_id: match[1],
    excel_name: collapseSpaces(match[2]),
    dept: collapseSpaces(match[3] || '')
  };
}

/* ------------------------------------------------------------------ */
/* Interpretacion de marcas                                            */
/* ------------------------------------------------------------------ */

export function parsePunches(value) {
  const raw = [];
  if (value === null || value === undefined) return [];

  if (value instanceof Date) {
    raw.push(formatTime(value.getHours(), value.getMinutes()));
  } else if (typeof value === 'number') {
    // Excel guarda las horas como fraccion de dia.
    const fraction = value - Math.floor(value);
    if (fraction > 0) raw.push(fractionToTime(fraction));
  } else if (typeof value === 'string') {
    const matches = value.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
    matches.forEach((time) => raw.push(normalizeTime(time)));
  } else if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      raw.push(...parsePunches(value.richText.map((part) => part.text).join('')));
    } else if (value.text !== undefined) {
      raw.push(...parsePunches(String(value.text)));
    } else if (value.result !== undefined) {
      raw.push(...parsePunches(value.result));
    }
  }

  // Deduplica marcas consecutivas repetidas: el biometrico a veces registra
  // dos veces la misma salida (18:01, 18:01) y eso no debe crear columnas de mas.
  const punches = [];
  for (const time of raw.filter(Boolean)) {
    if (punches[punches.length - 1] === time) continue;
    punches.push(time);
  }
  return punches;
}

export function mapPunches(punches) {
  const times = punches.filter(Boolean);
  if (!times.length) return null;
  if (times.length === 1) {
    return { entry_time: times[0], lunch_out: '', lunch_in: '', exit_time: '', punch_count: 1 };
  }
  if (times.length === 2) {
    // Con dos marcas hay dos casos posibles:
    //   - la segunda es temprano (antes de las 15:00): casi siempre es la
    //     salida al almuerzo y el equipo no registro el regreso ni la salida
    //     (pasa en medias jornadas y feriados). Se deja como salida de
    //     almuerzo para no inventar una salida antes de las 18:00.
    //   - la segunda es en la tarde/noche: es la salida real del dia.
    if (timeToMinutes(times[1]) < 15 * 60) {
      return { entry_time: times[0], lunch_out: times[1], lunch_in: '', exit_time: '', punch_count: 2 };
    }
    return { entry_time: times[0], lunch_out: '', lunch_in: '', exit_time: times[1], punch_count: 2 };
  }
  if (times.length === 3) {
    return { entry_time: times[0], lunch_out: times[1], lunch_in: times[2], exit_time: '', punch_count: 3 };
  }
  return {
    entry_time: times[0],
    lunch_out: times[1],
    lunch_in: times[2],
    exit_time: times[times.length - 1],
    punch_count: times.length
  };
}

/* ------------------------------------------------------------------ */
/* Coincidencia de nombres con los trabajadores del sistema            */
/* ------------------------------------------------------------------ */

/**
 * Compara los nombres del Excel con los trabajadores de una sucursal.
 * Devuelve una sugerencia por nombre. Cuando hay dos trabajadores con el mismo
 * nombre (por ejemplo "DAVIER NAZARENO" duplicado) la coincidencia es ambigua
 * y se deja sin asignar para que el usuario elija.
 *
 * @param {string[]} excelNames
 * @param {Array<{id: string|number, full_name: string}>} candidates
 */
export function suggestMatches(excelNames, candidates) {
  return excelNames.map((excelName) => {
    const scored = candidates
      .map((candidate) => ({ candidate, score: scoreName(excelName, candidate.full_name) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.candidate.full_name).localeCompare(String(b.candidate.full_name)));

    if (!scored.length) {
      return { match: 'none', worker_id: null, alternatives: [], score: 0 };
    }

    const top = scored[0];
    const close = scored.filter((item) => top.score - item.score < 0.05);
    const alternatives = close.map((item) => String(item.candidate.id));

    if (close.length > 1) {
      return { match: 'ambiguous', worker_id: null, alternatives, score: top.score };
    }

    return {
      match: top.score >= 0.995 ? 'exact' : 'probable',
      worker_id: String(top.candidate.id),
      alternatives,
      score: Number(top.score.toFixed(3))
    };
  });
}

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreName(excelName, fullName) {
  const excelTokens = normalizeName(excelName).split(' ').filter(Boolean);
  const candidateTokens = normalizeName(fullName).split(' ').filter(Boolean);
  if (!excelTokens.length || !candidateTokens.length) return 0;

  let total = 0;
  for (const token of excelTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      best = Math.max(best, tokenSimilarity(token, candidateToken));
    }
    // Si alguna palabra del Excel no aparece en el trabajador, no es candidato.
    if (best < 0.7) return 0;
    total += best;
  }
  return total / excelTokens.length;
}

function tokenSimilarity(a, b) {
  if (a === b) return 1;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return Math.max(1 - levenshtein(a, b) / longest, 0);
}

function levenshtein(a, b) {
  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
  if (value.text !== undefined) return String(value.text).trim();
  if (value.result !== undefined) return cellText(value.result);
  return '';
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  // 00:00 en estos reportes significa "sin marca".
  if (hours === 0 && minutes === 0) return '';
  return `${pad(hours)}:${pad(minutes)}`;
}

function fractionToTime(fraction) {
  const totalMinutes = Math.round(fraction * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

function formatTime(hours, minutes) {
  return `${pad(hours)}:${pad(minutes)}`;
}

function splitIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function pad(value) {
  return String(value).padStart(2, '0');
}
