// Migra todos los datos a Turso (libSQL en la nube).
//
// Uso recomendado (copia desde el servidor Windows, que es la base real):
//
//   $env:TURSO_DATABASE_URL = "libsql://..."
//   $env:TURSO_AUTH_TOKEN   = "eyJ..."
//   $env:SOURCE             = "remote"
//   $env:SOURCE_API_URL     = "https://asistencias-pas.tail6b95f3.ts.net"
//   $env:SOURCE_API_TOKEN   = "token de STORE_API"
//   node scripts/migrate-to-turso.mjs
//
// Para copiar desde la base local en lugar del servidor:
//
//   $env:SOURCE = "local"
//   $env:DATABASE_FILE = "./data/asistencias.db"
//   node scripts/migrate-to-turso.mjs
//
// El script reemplaza el contenido actual de Turso con el origen elegido.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client/web';
import { initStore } from '../src/tursoStore.js';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl) {
  console.error('Falta TURSO_DATABASE_URL.');
  process.exit(1);
}

const source = (process.env.SOURCE || 'remote').trim().toLowerCase();
const client = createClient({ url: tursoUrl, authToken: tursoToken || undefined });

console.log(`Origen: ${source}`);
const dataset = source === 'local' ? readLocal() : await readRemote();

console.log('Preparando esquema en Turso...');
await initStore();
console.log('Limpiando tablas de Turso...');

const deleteOrder = [
  'certificates', 'attendance_records', 'vacations', 'vacation_deductions',
  'attention_calls', 'job_abandonments', 'medical_withdrawals', 'workers', 'branches'
];
for (const table of deleteOrder) {
  await client.execute(`DELETE FROM ${table}`);
}

console.log('Copiando datos...');
const results = {};
results.branches = await insertRows('branches', ['id', 'name', 'created_at', 'updated_at'], dataset.branches);
results.workers = await insertRows(
  'workers',
  ['id', 'full_name', 'cedula', 'position', 'branch', 'hire_date', 'status', 'created_at', 'updated_at'],
  dataset.workers
);
results.attendance = await insertRows(
  'attendance_records',
  [
    'id', 'worker_id', 'record_date', 'status', 'entry_time', 'scheduled_entry_time', 'actual_arrival_time',
    'late_minutes', 'observation', 'registered_by', 'justified_reason', 'has_support_doc', 'permit_time_out',
    'permit_time_return', 'permit_reason', 'permit_full_day', 'lunch_out', 'lunch_in', 'exit_time',
    'created_at', 'updated_at'
  ],
  dataset.attendance
);
results.vacations = await insertRows(
  'vacations',
  ['id', 'worker_id', 'start_date', 'end_date', 'total_days', 'observation', 'status', 'created_at', 'updated_at'],
  dataset.vacations
);
results.vacationDeductions = await insertRows(
  'vacation_deductions',
  ['id', 'worker_id', 'days', 'reason', 'record_date', 'registered_by', 'created_at', 'updated_at'],
  dataset.vacationDeductions
);
results.attentionCalls = await insertRows(
  'attention_calls',
  ['id', 'worker_id', 'record_date', 'reason', 'description', 'registered_by', 'created_at', 'updated_at'],
  dataset.attentionCalls
);
results.jobAbandonments = await insertRows(
  'job_abandonments',
  ['id', 'worker_id', 'record_date', 'exit_time', 'reason', 'observation', 'registered_by', 'created_at', 'updated_at'],
  dataset.jobAbandonments
);
results.medicalWithdrawals = await insertRows(
  'medical_withdrawals',
  ['id', 'worker_id', 'record_date', 'exit_time', 'cause', 'description', 'has_support_doc', 'registered_by', 'created_at', 'updated_at'],
  dataset.medicalWithdrawals
);
results.certificates = await insertRows(
  'certificates',
  ['id', 'worker_id', 'record_date', 'file_name', 'mime_type', 'size_bytes', 'data_base64', 'uploaded_by', 'created_at', 'updated_at'],
  dataset.certificates,
  20
);

console.log('\nCopiado:');
for (const [key, value] of Object.entries(results)) console.log(`  ${key}: ${value}`);

console.log('\nVerificacion en Turso:');
const checkTables = [
  'workers', 'branches', 'attendance_records', 'vacations', 'vacation_deductions',
  'attention_calls', 'job_abandonments', 'medical_withdrawals', 'certificates'
];
for (const table of checkTables) {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  console.log(`  ${table}: ${result.rows[0]?.n}`);
}
console.log('\nMigracion completada.');

/* ------------------------------------------------------------------ */
/* Origen: servidor remoto (API de datos)                              */
/* ------------------------------------------------------------------ */
async function readRemote() {
  const base = (process.env.SOURCE_API_URL || '').replace(/\/+$/, '');
  const token = process.env.SOURCE_API_TOKEN || '';
  if (!base) throw new Error('Falta SOURCE_API_URL.');
  if (!token) throw new Error('Falta SOURCE_API_TOKEN.');

  async function callApi(method, args = []) {
    const response = await fetch(`${base}/api/store/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ args }),
      signal: AbortSignal.timeout(120000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(`${method}: ${payload?.error || `HTTP ${response.status}`}`);
    }
    return payload.result;
  }

  const data = {
    branches: await callApi('listBranches'),
    workers: await callApi('listWorkers'),
    attendance: await callApi('listAttendance'),
    vacations: await callApi('listVacations'),
    vacationDeductions: await callApi('listVacationDeductions'),
    attentionCalls: await callApi('listAttentionCalls'),
    jobAbandonments: await callApi('listJobAbandonments'),
    medicalWithdrawals: await callApi('listMedicalWithdrawals'),
    certificates: []
  };

  const withDoc = data.attendance.filter((record) => Number(record.has_support_doc));
  console.log(`Certificados por copiar: ${withDoc.length}`);
  for (const record of withDoc) {
    try {
      const meta = await callApi('findCertificate', [record.worker_id, record.record_date]);
      if (!meta) {
        console.warn(`  Registro marcado con documento pero sin certificado (${record.worker_id}/${record.record_date}); se omite.`);
        continue;
      }
      let file = {};
      try {
        file = await callApi('readCertificate', [record.worker_id, record.record_date]);
      } catch (error) {
        console.warn(`  Certificado sin archivo en el servidor (${record.worker_id}/${record.record_date}); se copia solo el registro.`);
      }
      data.certificates.push({
        ...meta,
        ...file,
        worker_id: record.worker_id,
        record_date: record.record_date
      });
    } catch (error) {
      console.warn(`  Certificado omitido (${record.worker_id}/${record.record_date}): ${error.message}`);
    }
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Origen: archivo SQLite local                                        */
/* ------------------------------------------------------------------ */
function readLocal() {
  const { DatabaseSync } = requireNodeSqlite();
  const file = path.resolve(process.env.DATABASE_FILE || path.join('data', 'asistencias.db'));
  if (!fs.existsSync(file)) throw new Error(`No existe la base local: ${file}`);
  console.log(`Base local: ${file}`);
  const db = new DatabaseSync(file);
  const all = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));

  const directory = process.env.CERTIFICATES_DIR
    ? path.resolve(process.env.CERTIFICATES_DIR)
    : path.join(path.dirname(file), 'certificados');

  const certificates = all('SELECT * FROM certificates').map((row) => {
    const extension = extensionFor(row.mime_type);
    const certificateFile = path.join(directory, `certificado-trabajador-${row.worker_id}-${row.record_date}${extension}`);
    let dataBase64 = '';
    try {
      dataBase64 = fs.readFileSync(certificateFile).toString('base64');
    } catch {
      console.warn(`  Certificado sin archivo: ${certificateFile}`);
    }
    return { ...row, data_base64: dataBase64 };
  });

  return {
    branches: all('SELECT * FROM branches'),
    workers: all('SELECT * FROM workers'),
    attendance: all('SELECT * FROM attendance_records'),
    vacations: all('SELECT * FROM vacations'),
    vacationDeductions: all('SELECT * FROM vacation_deductions'),
    attentionCalls: all('SELECT * FROM attention_calls'),
    jobAbandonments: all('SELECT * FROM job_abandonments'),
    medicalWithdrawals: all('SELECT * FROM medical_withdrawals'),
    certificates
  };
}

function extensionFor(mimeType) {
  return {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
  }[mimeType] || '';
}

function isNumericColumn(column) {
  return [
    'id', 'worker_id', 'late_minutes', 'has_support_doc', 'permit_full_day',
    'total_days', 'days', 'size_bytes'
  ].includes(column);
}

async function insertRows(table, columns, rows, chunkSize = 100) {
  let total = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const statements = chunk.map((row) => ({
      sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      args: columns.map((column) => valueFor(column, row[column]))
    }));
    if (!statements.length) continue;
    await client.batch(statements, 'write');
    total += statements.length;
  }
  return total;
}

function valueFor(column, value) {
  if (isNumericColumn(column)) return Number(value) || 0;
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function requireNodeSqlite() {
  // node:sqlite es experimental; se carga de forma sincrona solo cuando se usa.
  return process.getBuiltinModule('node:sqlite');
}
