// Selector de almacenamiento.
// DATA_BACKEND=sqlite (por defecto en local) usa la base de datos local.
// DATA_BACKEND=turso usa la base libSQL en la nube (recomendado en produccion).
// DATA_BACKEND=remote usa la API del servidor (Vercel + Cloudflare Tunnel).
// DATA_BACKEND=sheets mantiene el comportamiento anterior con Google Sheets.
// En Vercel el modo por defecto es "remote" para no intentar abrir SQLite.
//
// remoteStore y tursoStore se importan de forma estatica a proposito: los
// empaquetadores de Vercel no detectan los imports dinamicos y el archivo
// quedaba fuera de la funcion desplegada. sqlite y sheets siguen siendo
// dinamicos para que sus dependencias solo se carguen cuando se usan.
import * as remoteStore from './remoteStore.js';
import * as tursoStore from './tursoStore.js';

const defaultBackend = process.env.VERCEL ? 'remote' : 'sqlite';
const backend = (process.env.DATA_BACKEND || defaultBackend).trim().toLowerCase();

const backends = {
  sqlite: () => import('./dbStore.js'),
  turso: async () => tursoStore,
  remote: async () => remoteStore,
  sheets: () => import('./sheetsStore.js')
};

if (!backends[backend]) {
  throw new Error(`DATA_BACKEND invalido: "${backend}". Use "sqlite", "turso", "remote" o "sheets".`);
}

const store = await backends[backend]();

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
  upsertAttendanceBatch,
  updateAttendanceRecord,
  deleteAttendanceRecord,
  saveCertificate,
  findCertificate,
  readCertificate,
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
