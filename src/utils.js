export const attendanceStatuses = [
  'ASISTENCIA NORMAL',
  'FALTA JUSTIFICADA',
  'FALTA INJUSTIFICADA',
  'ATRASO',
  'VACACIONES',
  'PERMISO'
];

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIME_ZONE || 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function currentMonth() {
  return today().slice(0, 7);
}

export function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(diff, 0);
}

export function daysInclusive(start, end) {
  const a = dateOrdinal(start);
  const b = dateOrdinal(end);
  if (a === null || b === null || b < a) return 0;
  return b - a + 1;
}

export function completedYears(start, end) {
  const startParts = dateParts(start);
  const endParts = dateParts(end);
  if (!startParts || !endParts || dateOrdinal(end) < dateOrdinal(start)) return 0;
  let years = endParts.year - startParts.year;
  const anniversary = `${endParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;
  if (!dateParts(anniversary)) {
    if (endParts.month < 2 || (endParts.month === 2 && endParts.day < 28)) years -= 1;
  } else if (end < anniversary) {
    years -= 1;
  }
  return Math.max(years, 0);
}

export function isValidDate(value) {
  return dateOrdinal(value) !== null;
}

export function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(year, monthNumber, 0).getDate();
  return { start, end: `${month}-${String(endDate).padStart(2, '0')}` };
}

export function requireText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function dateOrdinal(value) {
  const parts = dateParts(value);
  return parts ? Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000) : null;
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}
