// Almacenamiento en Turso (libSQL en la nube).
// Mantiene la misma interfaz que dbStore.js, pero todas las consultas son
// asincronas porque viajan por HTTPS hasta la base remota.
//
// Variables de entorno:
//   TURSO_DATABASE_URL = libsql://asistencias-....turso.io
//   TURSO_AUTH_TOKEN   = token de la base
//
// Los certificados se guardan dentro de la misma base (columna data_base64),
// por lo que ya no dependen de archivos en el servidor Windows.
import { createClient } from '@libsql/client/web';

let connection;

function getClient() {
  if (connection) return connection;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('Falta TURSO_DATABASE_URL.');
  connection = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined
  });
  return connection;
}

const schema = `
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  cedula TEXT NOT NULL UNIQUE,
  position TEXT NOT NULL,
  branch TEXT NOT NULL,
  hire_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Activo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_name ON branches (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  status TEXT NOT NULL,
  entry_time TEXT DEFAULT '',
  scheduled_entry_time TEXT DEFAULT '',
  actual_arrival_time TEXT DEFAULT '',
  late_minutes INTEGER DEFAULT 0,
  observation TEXT DEFAULT '',
  registered_by TEXT DEFAULT '',
  justified_reason TEXT DEFAULT '',
  has_support_doc INTEGER DEFAULT 0,
  permit_time_out TEXT DEFAULT '',
  permit_time_return TEXT DEFAULT '',
  permit_reason TEXT DEFAULT '',
  permit_full_day INTEGER DEFAULT 0,
  lunch_out TEXT DEFAULT '',
  lunch_in TEXT DEFAULT '',
  exit_time TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (worker_id, record_date)
);

CREATE TABLE IF NOT EXISTS vacations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_days INTEGER DEFAULT 0,
  observation TEXT DEFAULT '',
  status TEXT DEFAULT 'Programadas',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vacation_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  days INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  record_date TEXT DEFAULT '',
  registered_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attention_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  description TEXT DEFAULT '',
  registered_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_abandonments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  exit_time TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  observation TEXT DEFAULT '',
  registered_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  exit_time TEXT DEFAULT '',
  cause TEXT DEFAULT '',
  description TEXT DEFAULT '',
  has_support_doc INTEGER DEFAULT 0,
  registered_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (record_date);
CREATE INDEX IF NOT EXISTS idx_attendance_worker ON attendance_records (worker_id);
CREATE INDEX IF NOT EXISTS idx_vacations_worker ON vacations (worker_id);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER DEFAULT 0,
  data_base64 TEXT DEFAULT '',
  uploaded_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (worker_id, record_date)
);
`;

const attendanceColumns = [
  'worker_id', 'record_date', 'status', 'entry_time', 'scheduled_entry_time', 'actual_arrival_time',
  'late_minutes', 'observation', 'registered_by', 'justified_reason', 'has_support_doc', 'permit_time_out',
  'permit_time_return', 'permit_reason', 'permit_full_day', 'lunch_out', 'lunch_in', 'exit_time'
];
const attendanceUpdates = attendanceColumns.filter((column) => column !== 'worker_id' && column !== 'record_date');
const attendanceUpsertSql = `
  INSERT INTO attendance_records (${attendanceColumns.join(', ')}, created_at, updated_at)
  VALUES (${attendanceColumns.map(() => '?').join(', ')}, ?, ?)
  ON CONFLICT(worker_id, record_date) DO UPDATE SET
    ${attendanceUpdates.map((column) => `${column} = excluded.${column}`).join(', ')},
    updated_at = excluded.updated_at
`;

const certificateColumns = ['worker_id', 'record_date', 'file_name', 'mime_type', 'size_bytes', 'data_base64', 'uploaded_by'];

export async function initStore() {
  const client = getClient();
  for (const statement of splitStatements(schema)) {
    await client.execute(statement);
  }
  try {
    await client.execute('PRAGMA foreign_keys = ON');
  } catch {
    // En Turso las claves foraneas ya estan activas; si el pragma falla no es bloqueante.
  }

  await ensureColumns('attendance_records', {
    lunch_out: "TEXT DEFAULT ''",
    lunch_in: "TEXT DEFAULT ''",
    exit_time: "TEXT DEFAULT ''"
  });
  await ensureColumns('certificates', {
    data_base64: "TEXT DEFAULT ''"
  });
}

async function ensureColumns(table, definitions) {
  const rows = await all(`PRAGMA table_info(${table})`);
  const existing = new Set(rows.map((row) => row.name));
  for (const [column, definition] of Object.entries(definitions)) {
    if (!existing.has(column)) {
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

export async function listWorkers() {
  return (await all('SELECT * FROM workers ORDER BY id')).map(mapWorker);
}

export async function findWorker(id) {
  const row = await get('SELECT * FROM workers WHERE id = ?', [toInteger(id)]);
  return row ? mapWorker(row) : undefined;
}

export async function createWorker(worker) {
  if (await get('SELECT id FROM workers WHERE cedula = ?', [textValue(worker.cedula)])) {
    throw new Error('DUPLICATE_CEDULA');
  }
  const now = timestamp();
  try {
    await run(`
      INSERT INTO workers (full_name, cedula, position, branch, hire_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      textValue(worker.full_name),
      textValue(worker.cedula),
      textValue(worker.position),
      textValue(worker.branch),
      textValue(worker.hire_date),
      textValue(worker.status) || 'Activo',
      now,
      now
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_CEDULA');
    throw error;
  }
}

export async function updateWorker(id, worker) {
  const workerId = toInteger(id);
  const current = await get('SELECT * FROM workers WHERE id = ?', [workerId]);
  if (!current) return false;
  if (await get('SELECT id FROM workers WHERE cedula = ? AND id <> ?', [textValue(worker.cedula), workerId])) {
    throw new Error('DUPLICATE_CEDULA');
  }
  try {
    await run(`
      UPDATE workers
      SET full_name = ?, cedula = ?, position = ?, branch = ?, hire_date = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      textValue(worker.full_name ?? current.full_name),
      textValue(worker.cedula ?? current.cedula),
      textValue(worker.position ?? current.position),
      textValue(worker.branch ?? current.branch),
      textValue(worker.hire_date ?? current.hire_date),
      textValue(worker.status ?? current.status) || 'Activo',
      timestamp(),
      workerId
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_CEDULA');
    throw error;
  }
  return true;
}

export async function deleteWorkerAndData(id) {
  const workerId = toInteger(id);
  const childTables = [
    'certificates', 'attendance_records', 'vacations', 'vacation_deductions',
    'attention_calls', 'job_abandonments', 'medical_withdrawals'
  ];
  const statements = childTables.map((table) => ({
    sql: `DELETE FROM ${table} WHERE worker_id = ?`,
    args: [workerId]
  }));
  statements.push({ sql: 'DELETE FROM workers WHERE id = ?', args: [workerId] });
  const results = await getClient().batch(statements, 'write');
  return Number(results[results.length - 1]?.rowsAffected || 0) > 0;
}

export async function listBranches() {
  return (await all('SELECT * FROM branches ORDER BY name')).map(mapId);
}

export async function createBranch(name) {
  const value = textValue(name);
  if (!value) throw new Error('INVALID_BRANCH');
  if (await get('SELECT id FROM branches WHERE name = ? COLLATE NOCASE', [value])) {
    throw new Error('DUPLICATE_BRANCH');
  }
  const now = timestamp();
  try {
    await run('INSERT INTO branches (name, created_at, updated_at) VALUES (?, ?, ?)', [value, now, now]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_BRANCH');
    throw error;
  }
}

export async function listAttendance() {
  return (await all('SELECT * FROM attendance_records ORDER BY record_date, id')).map(mapAttendance);
}

export async function upsertAttendance(record) {
  const now = timestamp();
  await run(attendanceUpsertSql, [...attendanceValues(record), now, now]);
}

export async function upsertAttendanceBatch(records) {
  if (!Array.isArray(records) || !records.length) return 0;
  const now = timestamp();
  let total = 0;
  // libSQL acepta lotes; se envian de 100 en 100 para no exceder el limite.
  for (let index = 0; index < records.length; index += 100) {
    const chunk = records.slice(index, index + 100);
    const statements = chunk.map((record) => ({
      sql: attendanceUpsertSql,
      args: [...attendanceValues(record), now, now]
    }));
    await getClient().batch(statements, 'write');
    total += chunk.length;
  }
  return total;
}

export async function updateAttendanceRecord(id, record) {
  const recordId = toInteger(id);
  if (!recordId) throw new Error('REGISTRO_INVALIDO');
  const columns = attendanceColumns.filter((column) => column !== 'worker_id');
  const values = columns.map((column) => {
    if (column === 'late_minutes' || column === 'has_support_doc' || column === 'permit_full_day') {
      return toInteger(record[column]);
    }
    return textValue(record[column]);
  });
  try {
    const result = await run(`
      UPDATE attendance_records
      SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ?
      WHERE id = ?
    `, [...values, timestamp(), recordId]);
    return result.changes > 0;
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('REGISTRO_DUPLICADO');
    throw error;
  }
}

export async function deleteAttendanceRecord(id) {
  const recordId = toInteger(id);
  if (!recordId) throw new Error('REGISTRO_INVALIDO');
  const row = await get('SELECT worker_id, record_date FROM attendance_records WHERE id = ?', [recordId]);
  if (!row) return false;

  await getClient().batch([
    { sql: 'DELETE FROM certificates WHERE worker_id = ? AND record_date = ?', args: [row.worker_id, row.record_date] },
    { sql: 'DELETE FROM attendance_records WHERE id = ?', args: [recordId] }
  ], 'write');
  return true;
}

export async function saveCertificate(record) {
  const workerId = toInteger(record.worker_id);
  const recordDate = textValue(record.record_date);
  const dataBase64 = String(record.data_base64 || '');
  if (!workerId) throw new Error('CERTIFICADO_INVALIDO');
  if (!recordDate) throw new Error('CERTIFICADO_INVALIDO');
  if (!dataBase64) throw new Error('CERTIFICADO_VACIO');

  const mime = certificateExtensions[String(record.mime_type)] ? String(record.mime_type) : '';
  if (!mime) throw new Error('CERTIFICADO_INVALIDO');
  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw new Error('CERTIFICADO_VACIO');

  const now = timestamp();
  await run(`
    INSERT INTO certificates (${certificateColumns.join(', ')}, created_at, updated_at)
    VALUES (${certificateColumns.map(() => '?').join(', ')}, ?, ?)
    ON CONFLICT(worker_id, record_date) DO UPDATE SET
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      data_base64 = excluded.data_base64,
      uploaded_by = excluded.uploaded_by,
      updated_at = excluded.updated_at
  `, [
    workerId,
    recordDate,
    textValue(record.file_name) || `certificado-${workerId}-${recordDate}`,
    mime,
    buffer.length,
    dataBase64,
    textValue(record.uploaded_by),
    now,
    now
  ]);
  return { file_name: record.file_name, mime_type: mime, size_bytes: buffer.length };
}

export async function findCertificate(workerId, recordDate) {
  const row = await get(`
    SELECT id, worker_id, record_date, file_name, mime_type, size_bytes, uploaded_by, created_at, updated_at
    FROM certificates WHERE worker_id = ? AND record_date = ?
  `, [toInteger(workerId), textValue(recordDate)]);
  return row ? mapId(row) : undefined;
}

export async function listCertificates() {
  return (await all(`
    SELECT id, worker_id, record_date, file_name, mime_type, size_bytes, uploaded_by, created_at, updated_at
    FROM certificates ORDER BY record_date, id
  `)).map(mapId);
}

export async function readCertificate(workerId, recordDate) {
  const row = await get('SELECT * FROM certificates WHERE worker_id = ? AND record_date = ?', [toInteger(workerId), textValue(recordDate)]);
  if (!row || !row.data_base64) throw new Error('CERTIFICADO_NO_ENCONTRADO');
  return { mime_type: row.mime_type, file_name: String(row.file_name || ''), data_base64: String(row.data_base64) };
}

export async function listVacations() {
  return (await all('SELECT * FROM vacations ORDER BY start_date, id')).map((row) => ({
    ...mapChild(row),
    total_days: toInteger(row.total_days)
  }));
}

export async function createVacation(vacation) {
  const now = timestamp();
  await run(`
    INSERT INTO vacations (worker_id, start_date, end_date, total_days, observation, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    toInteger(vacation.worker_id),
    textValue(vacation.start_date),
    textValue(vacation.end_date),
    toInteger(vacation.total_days),
    textValue(vacation.observation),
    textValue(vacation.status) || 'Programadas',
    now,
    now
  ]);
}

export async function listVacationDeductions() {
  return (await all('SELECT * FROM vacation_deductions ORDER BY record_date, id')).map((row) => ({
    ...mapChild(row),
    days: toInteger(row.days)
  }));
}

export async function createVacationDeduction(deduction) {
  const now = timestamp();
  await run(`
    INSERT INTO vacation_deductions (worker_id, days, reason, record_date, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    toInteger(deduction.worker_id),
    toInteger(deduction.days),
    textValue(deduction.reason),
    textValue(deduction.record_date),
    textValue(deduction.registered_by),
    now,
    now
  ]);
}

export async function listAttentionCalls() {
  return (await all('SELECT * FROM attention_calls ORDER BY record_date, id')).map(mapChild);
}

export async function createAttentionCall(record) {
  const now = timestamp();
  await run(`
    INSERT INTO attention_calls (worker_id, record_date, reason, description, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.reason),
    textValue(record.description),
    textValue(record.registered_by),
    now,
    now
  ]);
}

export async function listJobAbandonments() {
  return (await all('SELECT * FROM job_abandonments ORDER BY record_date, id')).map(mapChild);
}

export async function createJobAbandonment(record) {
  const now = timestamp();
  await run(`
    INSERT INTO job_abandonments (worker_id, record_date, exit_time, reason, observation, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.exit_time),
    textValue(record.reason),
    textValue(record.observation),
    textValue(record.registered_by),
    now,
    now
  ]);
}

export async function listMedicalWithdrawals() {
  return (await all('SELECT * FROM medical_withdrawals ORDER BY record_date, id')).map((row) => ({
    ...mapChild(row),
    has_support_doc: toInteger(row.has_support_doc)
  }));
}

export async function createMedicalWithdrawal(record) {
  const now = timestamp();
  await run(`
    INSERT INTO medical_withdrawals (worker_id, record_date, exit_time, cause, description, has_support_doc, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.exit_time),
    textValue(record.cause),
    textValue(record.description),
    toInteger(record.has_support_doc),
    textValue(record.registered_by),
    now,
    now
  ]);
}

/**
 * Reemplaza todo el contenido de la base con un conjunto de datos externo
 * (por ejemplo, la migracion desde Google Sheets).
 */
export async function importAll(dataset) {
  const client = getClient();
  const order = [
    'attendance', 'vacations', 'vacationDeductions', 'attentionCalls',
    'jobAbandonments', 'medicalWithdrawals', 'certificates', 'workers', 'branches'
  ];
  const imported = {};

  const deleteStatements = order.map((key) => ({ sql: `DELETE FROM ${tableNames[key]}`, args: [] }));
  if (deleteStatements.length) await client.batch(deleteStatements, 'write');

  imported.branches = await insertMany('branches', dataset.branches || []);
  const workerRows = (dataset.workers || []).filter((row) => hasId(row));
  const validWorkerIds = new Set(workerRows.map((row) => toInteger(row.id)));
  imported.workers = await insertMany('workers', workerRows);
  imported.attendance = await insertMany('attendance', filterByWorker(dataset.attendance || [], validWorkerIds));
  imported.vacations = await insertMany('vacations', filterByWorker(dataset.vacations || [], validWorkerIds));
  imported.vacationDeductions = await insertMany('vacationDeductions', filterByWorker(dataset.vacationDeductions || [], validWorkerIds));
  imported.attentionCalls = await insertMany('attentionCalls', filterByWorker(dataset.attentionCalls || [], validWorkerIds));
  imported.jobAbandonments = await insertMany('jobAbandonments', filterByWorker(dataset.jobAbandonments || [], validWorkerIds));
  imported.medicalWithdrawals = await insertMany('medicalWithdrawals', filterByWorker(dataset.medicalWithdrawals || [], validWorkerIds));

  return imported;
}

async function insertMany(key, rows) {
  const columns = tables[key];
  const table = tableNames[key];
  let total = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100).filter((row) => hasId(row));
    if (!chunk.length) continue;
    const statements = chunk.map((row) => ({
      sql: `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
      args: [toInteger(row.id), ...columns.map((column) => importValue(column, row[column]))]
    }));
    await getClient().batch(statements, 'write');
    total += chunk.length;
  }
  return total;
}

const tables = {
  workers: ['full_name', 'cedula', 'position', 'branch', 'hire_date', 'status', 'created_at', 'updated_at'],
  branches: ['name', 'created_at', 'updated_at'],
  attendance: [...attendanceColumns, 'created_at', 'updated_at'],
  vacations: ['worker_id', 'start_date', 'end_date', 'total_days', 'observation', 'status', 'created_at', 'updated_at'],
  vacationDeductions: ['worker_id', 'days', 'reason', 'record_date', 'registered_by', 'created_at', 'updated_at'],
  attentionCalls: ['worker_id', 'record_date', 'reason', 'description', 'registered_by', 'created_at', 'updated_at'],
  jobAbandonments: ['worker_id', 'record_date', 'exit_time', 'reason', 'observation', 'registered_by', 'created_at', 'updated_at'],
  medicalWithdrawals: ['worker_id', 'record_date', 'exit_time', 'cause', 'description', 'has_support_doc', 'registered_by', 'created_at', 'updated_at'],
  certificates: certificateColumns
};

const tableNames = {
  workers: 'workers',
  branches: 'branches',
  attendance: 'attendance_records',
  vacations: 'vacations',
  vacationDeductions: 'vacation_deductions',
  attentionCalls: 'attention_calls',
  jobAbandonments: 'job_abandonments',
  medicalWithdrawals: 'medical_withdrawals',
  certificates: 'certificates'
};

const certificateExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

function importValue(column, value) {
  if (['worker_id', 'late_minutes', 'has_support_doc', 'permit_full_day', 'total_days', 'days', 'size_bytes'].includes(column)) {
    return toInteger(value);
  }
  return textValue(value);
}

function filterByWorker(rows, validWorkerIds) {
  return rows.filter((row) => hasId(row) && validWorkerIds.has(toInteger(row.worker_id)));
}

function hasId(row) {
  return Number.isInteger(Number(row?.id)) && Number(row.id) > 0;
}

function mapWorker(row) {
  return { ...mapId(row) };
}

function mapChild(row) {
  return { ...mapId(row), worker_id: String(row.worker_id) };
}

function mapId(row) {
  return { ...row, id: String(row.id) };
}

function mapAttendance(row) {
  return {
    ...mapChild(row),
    late_minutes: toInteger(row.late_minutes),
    has_support_doc: toInteger(row.has_support_doc),
    permit_full_day: toInteger(row.permit_full_day)
  };
}

function attendanceValues(record) {
  return attendanceColumns.map((column) => {
    if (column === 'worker_id' || column === 'late_minutes' || column === 'has_support_doc' || column === 'permit_full_day') {
      return toInteger(record[column]);
    }
    return textValue(record[column]);
  });
}

async function all(sql, args = []) {
  const result = await getClient().execute({ sql, args });
  return result.rows.map((row) => ({ ...row }));
}

async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0];
}

async function run(sql, args = []) {
  const result = await getClient().execute({ sql, args });
  return { changes: Number(result.rowsAffected || 0), lastInsertRowid: result.lastInsertRowid };
}

function splitStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(error?.message || '');
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
