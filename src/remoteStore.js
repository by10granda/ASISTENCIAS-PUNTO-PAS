// Adaptador para la app desplegada en Vercel.
// No accede a la base directamente: llama a la API del servidor por HTTPS
// (a traves de Cloudflare Tunnel) usando las mismas funciones que dbStore.

const baseUrl = (process.env.STORE_API_URL || '').replace(/\/+$/, '');
const token = process.env.STORE_API_TOKEN || '';
const timeout = Number(process.env.STORE_API_TIMEOUT_MS || 25000);

function requireConfig() {
  if (!baseUrl) throw new Error('Falta STORE_API_URL.');
  if (!token) throw new Error('Falta STORE_API_TOKEN.');
}

async function call(method, ...args) {
  requireConfig();
  const response = await fetch(`${baseUrl}/api/store/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ args }),
    signal: AbortSignal.timeout(timeout)
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`STORE_API_HTTP_${response.status}`);
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `STORE_API_HTTP_${response.status}`);
  }

  return payload.result;
}

export async function initStore() {
  requireConfig();
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('STORE_API_NO_DISPONIBLE');
}

export const listWorkers = () => call('listWorkers');
export const findWorker = (id) => call('findWorker', id);
export const createWorker = (worker) => call('createWorker', worker);
export const updateWorker = (id, worker) => call('updateWorker', id, worker);
export const deleteWorkerAndData = (id) => call('deleteWorkerAndData', id);

export const listBranches = () => call('listBranches');
export const createBranch = (name) => call('createBranch', name);

export const listAttendance = () => call('listAttendance');
export const upsertAttendance = (record) => call('upsertAttendance', record);
export const updateAttendanceRecord = (id, record) => call('updateAttendanceRecord', String(id), record);
export const deleteAttendanceRecord = (id) => call('deleteAttendanceRecord', String(id));

export const saveCertificate = (record) => call('saveCertificate', record);
export const findCertificate = (workerId, recordDate) => call('findCertificate', String(workerId), String(recordDate));
export const readCertificate = (workerId, recordDate) => call('readCertificate', String(workerId), String(recordDate));

export const listVacations = () => call('listVacations');
export const createVacation = (vacation) => call('createVacation', vacation);

export const listVacationDeductions = () => call('listVacationDeductions');
export const createVacationDeduction = (deduction) => call('createVacationDeduction', deduction);

export const listAttentionCalls = () => call('listAttentionCalls');
export const createAttentionCall = (record) => call('createAttentionCall', record);

export const listJobAbandonments = () => call('listJobAbandonments');
export const createJobAbandonment = (record) => call('createJobAbandonment', record);

export const listMedicalWithdrawals = () => call('listMedicalWithdrawals');
export const createMedicalWithdrawal = (record) => call('createMedicalWithdrawal', record);

export async function importAll() {
  throw new Error('importAll no esta disponible en modo remoto.');
}
