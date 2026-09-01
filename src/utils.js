export const attendanceStatuses = [
  'ASISTENCIA NORMAL',
  'FALTA JUSTIFICADA',
  'FALTA INJUSTIFICADA',
  'ATRASO',
  'VACACIONES',
  'PERMISO'
];

export function today() {
  return new Date().toISOString().slice(0, 10);
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
  if (!start || !end) return 0;
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
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
