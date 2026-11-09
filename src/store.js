// Selector de almacenamiento.
// DATA_BACKEND=sqlite (por defecto en local) usa la base de datos local.
// DATA_BACKEND=remote usa la API del servidor (Vercel + Cloudflare Tunnel).
// DATA_BACKEND=sheets mantiene el comportamiento anterior con Google Sheets.
// En Vercel el modo por defecto es "remote" para no intentar abrir SQLite.
const defaultBackend = process.env.VERCEL ? 'remote' : 'sqlite';
const backend = (process.env.DATA_BACKEND || defaultBackend).trim().toLowerCase();

const backends = {
  sqlite: './dbStore.js',
  remote: './remoteStore.js',
  sheets: './sheetsStore.js'
};

if (!backends[backend]) {
  throw new Error(`DATA_BACKEND invalido: "${backend}". Use "sqlite", "remote" o "sheets".`);
}

const store = await import(backends[backend]);

export const {
  initStore,
  listWorkers,
  findWorker,
  createWorker,
  updateWorker,
  deleteWorkerAndData,
  listBranches,
  createBranch,
  listAttendance,
  upsertAttendance,
  listVacations,
  createVacation,
  listVacationDeductions,
  createVacationDeduction,
  listAttentionCalls,
  createAttentionCall,
  listJobAbandonments,
  createJobAbandonment,
  listMedicalWithdrawals,
  createMedicalWithdrawal,
  importAll
} = store;
