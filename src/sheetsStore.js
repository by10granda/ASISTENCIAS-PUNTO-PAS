import { google } from 'googleapis';

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const sheetsConfig = {
  workers: {
    name: 'workers',
    headers: ['id', 'full_name', 'cedula', 'position', 'branch', 'hire_date', 'status', 'created_at', 'updated_at']
  },
  attendance: {
    name: 'attendance_records',
    headers: [
      'id', 'worker_id', 'record_date', 'status', 'entry_time', 'scheduled_entry_time', 'actual_arrival_time',
      'late_minutes', 'observation', 'registered_by', 'justified_reason', 'has_support_doc', 'permit_time_out',
      'permit_time_return', 'permit_reason', 'permit_full_day', 'created_at', 'updated_at'
    ]
  },
  vacations: {
    name: 'vacations',
    headers: ['id', 'worker_id', 'start_date', 'end_date', 'total_days', 'observation', 'status', 'created_at', 'updated_at']
  }
};

let client;

function getClient() {
  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('Faltan variables GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY.');
  }
  if (!client) {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    client = google.sheets({ version: 'v4', auth });
  }
  return client;
}

export async function initStore() {
  const sheets = getClient();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(metadata.data.sheets.map((sheet) => sheet.properties.title));

  const requests = Object.values(sheetsConfig)
    .filter((config) => !existing.has(config.name))
    .map((config) => ({ addSheet: { properties: { title: config.name } } }));

  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  await Promise.all(Object.values(sheetsConfig).map(async (config) => {
    const values = await readValues(config.name);
    const currentHeaders = values[0] || [];
    if (currentHeaders.join('|') !== config.headers.join('|')) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${config.name}!A1:${columnName(config.headers.length)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [config.headers] }
      });
    }
  }));
}

export async function listWorkers() {
  return readRows(sheetsConfig.workers);
}

export async function findWorker(id) {
  return (await listWorkers()).find((worker) => worker.id === String(id));
}

export async function createWorker(worker) {
  const workers = await listWorkers();
  if (workers.some((item) => item.cedula === worker.cedula)) throw new Error('DUPLICATE_CEDULA');
  const now = timestamp();
  await appendRow(sheetsConfig.workers, { ...worker, id: nextId(workers), created_at: now, updated_at: now });
}

export async function updateWorker(id, worker) {
  const rows = await readRowsWithNumbers(sheetsConfig.workers);
  const current = rows.find((row) => row.id === String(id));
  if (!current) return false;
  if (rows.some((row) => row.id !== String(id) && row.cedula === worker.cedula)) throw new Error('DUPLICATE_CEDULA');
  await updateRow(sheetsConfig.workers, current.rowNumber, { ...current, ...worker, id: String(id), updated_at: timestamp() });
  return true;
}

export async function listAttendance() {
  return normalizeNumbers(await readRows(sheetsConfig.attendance), ['late_minutes']);
}

export async function upsertAttendance(record) {
  const rows = await readRowsWithNumbers(sheetsConfig.attendance);
  const existing = rows.find((row) => row.worker_id === String(record.worker_id) && row.record_date === record.record_date);
  const now = timestamp();
  if (existing) {
    await updateRow(sheetsConfig.attendance, existing.rowNumber, { ...existing, ...record, id: existing.id, created_at: existing.created_at, updated_at: now });
    return;
  }
  await appendRow(sheetsConfig.attendance, { ...record, id: nextId(rows), created_at: now, updated_at: now });
}

export async function listVacations() {
  return normalizeNumbers(await readRows(sheetsConfig.vacations), ['total_days']);
}

export async function createVacation(vacation) {
  const vacations = await listVacations();
  const now = timestamp();
  await appendRow(sheetsConfig.vacations, { ...vacation, id: nextId(vacations), created_at: now, updated_at: now });
}

async function readRows(config) {
  const values = await readValues(config.name);
  const rows = values.slice(1);
  return rows.map((row) => objectFromRow(config.headers, row));
}

async function readRowsWithNumbers(config) {
  const rows = await readRows(config);
  return rows.map((row, index) => ({ ...row, rowNumber: index + 2 }));
}

async function readValues(sheetName) {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:Z` });
  return response.data.values || [];
}

async function appendRow(config, data) {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${config.name}!A:${columnName(config.headers.length)}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowFromObject(config.headers, data)] }
  });
}

async function updateRow(config, rowNumber, data) {
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${config.name}!A${rowNumber}:${columnName(config.headers.length)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [rowFromObject(config.headers, data)] }
  });
}

function objectFromRow(headers, row) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] ?? '';
    return acc;
  }, {});
}

function rowFromObject(headers, data) {
  return headers.map((header) => data[header] ?? '');
}

function nextId(rows) {
  const max = rows.reduce((value, row) => Math.max(value, Number(row.id) || 0), 0);
  return String(max + 1);
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeNumbers(rows, fields) {
  return rows.map((row) => {
    const next = { ...row };
    fields.forEach((field) => next[field] = Number(next[field]) || 0);
    return next;
  });
}

function columnName(index) {
  let name = '';
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}
