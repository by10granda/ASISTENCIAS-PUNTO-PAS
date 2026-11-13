import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const configuredFile = process.env.DATABASE_FILE || path.join('data', 'asistencias.db');
export const databaseFile = configuredFile === ':memory:' ? ':memory:' : path.resolve(configuredFile);

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

const tables = {
  workers: ['full_name', 'cedula', 'position', 'branch', 'hire_date', 'status', 'created_at', 'updated_at'],
  branches: ['name', 'created_at', 'updated_at'],
  attendance: [...attendanceColumns, 'created_at', 'updated_at'],
  vacations: ['worker_id', 'start_date', 'end_date', 'total_days', 'observation', 'status', 'created_at', 'updated_at'],
  vacationDeductions: ['worker_id', 'days', 'reason', 'record_date', 'registered_by', 'created_at', 'updated_at'],
  attentionCalls: ['worker_id', 'record_date', 'reason', 'description', 'registered_by', 'created_at', 'updated_at'],
  jobAbandonments: ['worker_id', 'record_date', 'exit_time', 'reason', 'observation', 'registered_by', 'created_at', 'updated_at'],
  medicalWithdrawals: ['worker_id', 'record_date', 'exit_time', 'cause', 'description', 'has_support_doc', 'registered_by', 'created_at', 'updated_at']
};

const tableNames = {
  workers: 'workers',
  branches: 'branches',
  attendance: 'attendance_records',
  vacations: 'vacations',
  vacationDeductions: 'vacation_deductions',
  attentionCalls: 'attention_calls',
  jobAbandonments: 'job_abandonments',
  medicalWithdrawals: 'medical_withdrawals'
};

let connection;

function getDb() {
  if (connection) return connection;
  if (databaseFile !== ':memory:') fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  connection = new DatabaseSync(databaseFile);
  connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec('PRAGMA foreign_keys = ON;');
  return connection;
}

export async function initStore() {
  getDb().exec(schema);
  /* Migración: agregar columnas de almuerzo a registros existentes */
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(attendance_records)").all().map((row) => row.name);
  for (const column of ['lunch_out', 'lunch_in', 'exit_time']) {
    if (!columns.includes(column)) {
      db.prepare(`ALTER TABLE attendance_records ADD COLUMN ${column} TEXT DEFAULT ''`).run();
    }
  }
}

export async function listWorkers() {
  return getDb().prepare('SELECT * FROM workers ORDER BY id').all().map(mapWorker);
}

export async function findWorker(id) {
  const row = getDb().prepare('SELECT * FROM workers WHERE id = ?').get(toInteger(id));
  return row ? mapWorker(row) : undefined;
}

export async function createWorker(worker) {
  const db = getDb();
  if (db.prepare('SELECT id FROM workers WHERE cedula = ?').get(textValue(worker.cedula))) {
    throw new Error('DUPLICATE_CEDULA');
  }
  const now = timestamp();
  try {
    db.prepare(`
      INSERT INTO workers (full_name, cedula, position, branch, hire_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      textValue(worker.full_name),
      textValue(worker.cedula),
      textValue(worker.position),
      textValue(worker.branch),
      textValue(worker.hire_date),
      textValue(worker.status) || 'Activo',
      now,
      now
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_CEDULA');
    throw error;
  }
}

export async function updateWorker(id, worker) {
  const db = getDb();
  const workerId = toInteger(id);
  const current = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!current) return false;
  if (db.prepare('SELECT id FROM workers WHERE cedula = ? AND id <> ?').get(textValue(worker.cedula), workerId)) {
    throw new Error('DUPLICATE_CEDULA');
  }
  try {
    db.prepare(`
      UPDATE workers
      SET full_name = ?, cedula = ?, position = ?, branch = ?, hire_date = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      textValue(worker.full_name ?? current.full_name),
      textValue(worker.cedula ?? current.cedula),
      textValue(worker.position ?? current.position),
      textValue(worker.branch ?? current.branch),
      textValue(worker.hire_date ?? current.hire_date),
      textValue(worker.status ?? current.status) || 'Activo',
      timestamp(),
      workerId
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_CEDULA');
    throw error;
  }
  return true;
}

export async function deleteWorkerAndData(id) {
  const result = getDb().prepare('DELETE FROM workers WHERE id = ?').run(toInteger(id));
  return result.changes > 0;
}

export async function listBranches() {
  return getDb().prepare('SELECT * FROM branches ORDER BY name').all().map(mapId);
}

export async function createBranch(name) {
  const db = getDb();
  const value = textValue(name);
  if (!value) throw new Error('INVALID_BRANCH');
  if (db.prepare('SELECT id FROM branches WHERE name = ? COLLATE NOCASE').get(value)) {
    throw new Error('DUPLICATE_BRANCH');
  }
  const now = timestamp();
  try {
    db.prepare('INSERT INTO branches (name, created_at, updated_at) VALUES (?, ?, ?)').run(value, now, now);
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('DUPLICATE_BRANCH');
    throw error;
  }
}

export async function listAttendance() {
  return getDb().prepare('SELECT * FROM attendance_records ORDER BY record_date, id').all().map(mapAttendance);
}

export async function upsertAttendance(record) {
  const now = timestamp();
  getDb().prepare(attendanceUpsertSql).run(...attendanceValues(record), now, now);
}

export async function upsertAttendanceBatch(records) {
  if (!Array.isArray(records) || !records.length) return 0;
  const db = getDb();
  const statement = db.prepare(attendanceUpsertSql);
  const now = timestamp();
  db.exec('BEGIN');
  try {
    for (const record of records) {
      statement.run(...attendanceValues(record), now, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return records.length;
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
    const result = getDb().prepare(`
      UPDATE attendance_records
      SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ?
      WHERE id = ?
    `).run(...values, timestamp(), recordId);
    return result.changes > 0;
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('REGISTRO_DUPLICADO');
    throw error;
  }
}

export async function deleteAttendanceRecord(id) {
  const recordId = toInteger(id);
  if (!recordId) throw new Error('REGISTRO_INVALIDO');
  const db = getDb();
  const row = db.prepare('SELECT worker_id, record_date FROM attendance_records WHERE id = ?').get(recordId);
  if (!row) return false;

  const certificate = db.prepare('SELECT mime_type, file_name FROM certificates WHERE worker_id = ? AND record_date = ?').get(row.worker_id, row.record_date);
  if (certificate) {
    const suffix = certificateExtensions[certificate.mime_type] || path.extname(String(certificate.file_name || ''));
    const filePath = path.join(certificateDir(), `certificado-trabajador-${row.worker_id}-${row.record_date}${suffix}`);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // El archivo pudo haberse eliminado antes; continuamos con la limpieza en la base.
    }
    db.prepare('DELETE FROM certificates WHERE worker_id = ? AND record_date = ?').run(row.worker_id, row.record_date);
  }

  const result = db.prepare('DELETE FROM attendance_records WHERE id = ?').run(recordId);
  return result.changes > 0;
}

function certificateDir() {
  const configured = process.env.CERTIFICATES_DIR;
  return configured ? path.resolve(configured) : path.join(path.dirname(databaseFile), 'certificados');
}

const certificateExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

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

  const directory = certificateDir();
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `certificado-trabajador-${workerId}-${recordDate}${certificateExtensions[mime]}`);
  fs.writeFileSync(filePath, buffer);

  const now = timestamp();
  const existing = getDb().prepare('SELECT id FROM certificates WHERE worker_id = ? AND record_date = ?').get(workerId, recordDate);
  if (existing) {
    getDb().prepare(`
      UPDATE certificates
      SET file_name = ?, mime_type = ?, size_bytes = ?, uploaded_by = ?, updated_at = ?
      WHERE id = ?
    `).run(textValue(record.file_name) || path.basename(filePath), mime, buffer.length, textValue(record.uploaded_by), now, existing.id);
  } else {
    getDb().prepare(`
      INSERT INTO certificates (worker_id, record_date, file_name, mime_type, size_bytes, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workerId, recordDate, textValue(record.file_name) || path.basename(filePath), mime, buffer.length, textValue(record.uploaded_by), now, now);
  }
  return { file_name: record.file_name || path.basename(filePath), mime_type: mime, size_bytes: buffer.length };
}

export async function findCertificate(workerId, recordDate) {
  const row = getDb().prepare('SELECT * FROM certificates WHERE worker_id = ? AND record_date = ?').get(toInteger(workerId), textValue(recordDate));
  return row ? mapId(row) : undefined;
}

export async function listCertificates() {
  return getDb().prepare('SELECT * FROM certificates ORDER BY record_date, id').all().map(mapId);
}

export async function readCertificate(workerId, recordDate) {
  const row = getDb().prepare('SELECT * FROM certificates WHERE worker_id = ? AND record_date = ?').get(toInteger(workerId), textValue(recordDate));
  if (!row) throw new Error('CERTIFICADO_NO_ENCONTRADO');
  const recordedName = String(row.file_name || '');
  const suffix = certificateExtensions[row.mime_type] ? certificateExtensions[row.mime_type] : path.extname(recordedName);
  const filePath = path.join(certificateDir(), `certificado-trabajador-${toInteger(workerId)}-${textValue(recordDate)}${suffix}`);
  if (!fs.existsSync(filePath)) throw new Error('CERTIFICADO_NO_ENCONTRADO');
  return { mime_type: row.mime_type, file_name: recordedName, data_base64: fs.readFileSync(filePath).toString('base64') };
}

export async function listVacations() {
  return getDb().prepare('SELECT * FROM vacations ORDER BY start_date, id').all().map((row) => ({
    ...mapChild(row),
    total_days: toInteger(row.total_days)
  }));
}

export async function createVacation(vacation) {
  const now = timestamp();
  getDb().prepare(`
    INSERT INTO vacations (worker_id, start_date, end_date, total_days, observation, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toInteger(vacation.worker_id),
    textValue(vacation.start_date),
    textValue(vacation.end_date),
    toInteger(vacation.total_days),
    textValue(vacation.observation),
    textValue(vacation.status) || 'Programadas',
    now,
    now
  );
}

export async function listVacationDeductions() {
  return getDb().prepare('SELECT * FROM vacation_deductions ORDER BY record_date, id').all().map((row) => ({
    ...mapChild(row),
    days: toInteger(row.days)
  }));
}

export async function createVacationDeduction(deduction) {
  const now = timestamp();
  getDb().prepare(`
    INSERT INTO vacation_deductions (worker_id, days, reason, record_date, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    toInteger(deduction.worker_id),
    toInteger(deduction.days),
    textValue(deduction.reason),
    textValue(deduction.record_date),
    textValue(deduction.registered_by),
    now,
    now
  );
}

export async function listAttentionCalls() {
  return getDb().prepare('SELECT * FROM attention_calls ORDER BY record_date, id').all().map(mapChild);
}

export async function createAttentionCall(record) {
  const now = timestamp();
  getDb().prepare(`
    INSERT INTO attention_calls (worker_id, record_date, reason, description, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.reason),
    textValue(record.description),
    textValue(record.registered_by),
    now,
    now
  );
}

export async function listJobAbandonments() {
  return getDb().prepare('SELECT * FROM job_abandonments ORDER BY record_date, id').all().map(mapChild);
}

export async function createJobAbandonment(record) {
  const now = timestamp();
  getDb().prepare(`
    INSERT INTO job_abandonments (worker_id, record_date, exit_time, reason, observation, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.exit_time),
    textValue(record.reason),
    textValue(record.observation),
    textValue(record.registered_by),
    now,
    now
  );
}

export async function listMedicalWithdrawals() {
  return getDb().prepare('SELECT * FROM medical_withdrawals ORDER BY record_date, id').all().map((row) => ({
    ...mapChild(row),
    has_support_doc: toInteger(row.has_support_doc)
  }));
}

export async function createMedicalWithdrawal(record) {
  const now = timestamp();
  getDb().prepare(`
    INSERT INTO medical_withdrawals (worker_id, record_date, exit_time, cause, description, has_support_doc, registered_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    toInteger(record.worker_id),
    textValue(record.record_date),
    textValue(record.exit_time),
    textValue(record.cause),
    textValue(record.description),
    toInteger(record.has_support_doc),
    textValue(record.registered_by),
    now,
    now
  );
}

/**
 * Reemplaza todo el contenido de la base con un conjunto de datos proveniente de
 * Google Sheets. Se conservan los ids originales para no romper las relaciones.
 */
export async function importAll(dataset) {
  const db = getDb();
  const order = [
    'attendance', 'vacations', 'vacationDeductions', 'attentionCalls',
    'jobAbandonments', 'medicalWithdrawals', 'workers', 'branches'
  ];
  const imported = {};

  db.exec('BEGIN');
  try {
    for (const key of order) db.exec(`DELETE FROM ${tableNames[key]}`);
    db.exec('DELETE FROM sqlite_sequence');

    imported.branches = insertMany('branches', dataset.branches || []);

    const workerRows = (dataset.workers || []).filter((row) => hasId(row));
    const validWorkerIds = new Set(workerRows.map((row) => toInteger(row.id)));
    imported.workers = insertMany('workers', workerRows);
    imported.attendance = insertMany('attendance', filterByWorker(dataset.attendance || [], validWorkerIds));
    imported.vacations = insertMany('vacations', filterByWorker(dataset.vacations || [], validWorkerIds));
    imported.vacationDeductions = insertMany('vacationDeductions', filterByWorker(dataset.vacationDeductions || [], validWorkerIds));
    imported.attentionCalls = insertMany('attentionCalls', filterByWorker(dataset.attentionCalls || [], validWorkerIds));
    imported.jobAbandonments = insertMany('jobAbandonments', filterByWorker(dataset.jobAbandonments || [], validWorkerIds));
    imported.medicalWithdrawals = insertMany('medicalWithdrawals', filterByWorker(dataset.medicalWithdrawals || [], validWorkerIds));

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return imported;
}

function insertMany(key, rows) {
  const columns = tables[key];
  const table = tableNames[key];
  const statement = getDb().prepare(`
    INSERT INTO ${table} (id, ${columns.join(', ')})
    VALUES (?, ${columns.map(() => '?').join(', ')})
  `);
  let total = 0;
  for (const row of rows) {
    if (!hasId(row)) continue;
    statement.run(toInteger(row.id), ...columns.map((column) => importValue(column, row[column])));
    total += 1;
  }
  return total;
}

function importValue(column, value) {
  if (['worker_id', 'late_minutes', 'has_support_doc', 'permit_full_day', 'total_days', 'days'].includes(column)) {
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
