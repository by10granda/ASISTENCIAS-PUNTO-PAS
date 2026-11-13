import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './dbStore.js';

// API de datos para la app desplegada en Vercel.
// La base SQLite vive en este servidor y solo se expone por Cloudflare Tunnel.

const methods = {
  listWorkers: { fn: db.listWorkers, args: 0 },
  findWorker: { fn: db.findWorker, args: 1 },
  createWorker: { fn: db.createWorker, args: 1 },
  updateWorker: { fn: db.updateWorker, args: 2 },
  deleteWorkerAndData: { fn: db.deleteWorkerAndData, args: 1 },
  listBranches: { fn: db.listBranches, args: 0 },
  createBranch: { fn: db.createBranch, args: 1 },
  listAttendance: { fn: db.listAttendance, args: 0 },
  upsertAttendance: { fn: db.upsertAttendance, args: 1 },
  upsertAttendanceBatch: { fn: db.upsertAttendanceBatch, args: 1 },
  updateAttendanceRecord: { fn: db.updateAttendanceRecord, args: 2 },
  deleteAttendanceRecord: { fn: db.deleteAttendanceRecord, args: 1 },
  saveCertificate: { fn: db.saveCertificate, args: 1 },
  findCertificate: { fn: db.findCertificate, args: 2 },
  readCertificate: { fn: db.readCertificate, args: 2 },
  listVacations: { fn: db.listVacations, args: 0 },
  createVacation: { fn: db.createVacation, args: 1 },
  listVacationDeductions: { fn: db.listVacationDeductions, args: 0 },
  createVacationDeduction: { fn: db.createVacationDeduction, args: 1 },
  listAttentionCalls: { fn: db.listAttentionCalls, args: 0 },
  createAttentionCall: { fn: db.createAttentionCall, args: 1 },
  listJobAbandonments: { fn: db.listJobAbandonments, args: 0 },
  createJobAbandonment: { fn: db.createJobAbandonment, args: 1 },
  listMedicalWithdrawals: { fn: db.listMedicalWithdrawals, args: 0 },
  createMedicalWithdrawal: { fn: db.createMedicalWithdrawal, args: 1 }
};

const token = process.env.STORE_API_TOKEN;
const port = Number(process.env.STORE_API_PORT || 3001);
const host = process.env.STORE_API_HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'asistencias-store-api' });
});

app.post('/api/store/:method', authorize, async (req, res) => {
  const method = methods[req.params.method];
  if (!method) {
    return res.status(404).json({ ok: false, error: 'METODO_NO_ENCONTRADO' });
  }

  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  if (args.length !== method.args) {
    return res.status(400).json({ ok: false, error: 'ARGUMENTOS_INVALIDOS' });
  }

  try {
    const result = await method.fn(...args);
    res.json({ ok: true, result: result ?? null });
  } catch (error) {
    console.error(`[store-api] ${req.params.method}:`, error.message);
    if (error.message === 'DUPLICATE_CEDULA' || error.message === 'DUPLICATE_BRANCH') {
      return res.status(409).json({ ok: false, error: error.message });
    }
    if (error.message?.startsWith('CERTIFICADO')) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    res.status(500).json({ ok: false, error: 'ERROR_INTERNO' });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: 'NO_ENCONTRADO' }));

function authorize(req, res, next) {
  if (!token) {
    return res.status(503).json({ ok: false, error: 'API_SIN_TOKEN_CONFIGURADO' });
  }
  const header = req.headers.authorization || '';
  const received = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-api-key'];
  if (!safeEqual(String(received || ''), token)) {
    return res.status(401).json({ ok: false, error: 'NO_AUTORIZADO' });
  }
  next();
}

function safeEqual(received, expected) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isDirectRun = path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  if (!token) {
    console.error('Falta STORE_API_TOKEN en el archivo .env. La API no se iniciara.');
    process.exit(1);
  }
  await db.initStore();
  app.listen(port, host, () => {
    console.log(`API de datos disponible en http://${host}:${port}`);
  });
}

export default app;
