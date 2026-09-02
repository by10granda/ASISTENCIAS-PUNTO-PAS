import { Router } from 'express';
import { sendExcel, sendPdf } from '../exporters.js';
import { listAttendance, listWorkers } from '../sheetsStore.js';
import { attendanceStatuses, clean } from '../utils.js';

export const historyRouter = Router();

const historyColumns = [
  { header: 'Fecha', key: 'record_date', width: 14 },
  { header: 'Trabajador', key: 'full_name', width: 28 },
  { header: 'Cedula', key: 'cedula', width: 16 },
  { header: 'Sucursal', key: 'branch', width: 18 },
  { header: 'Novedad', key: 'status', width: 22 },
  { header: 'Entrada', key: 'entry_time', width: 12 },
  { header: 'Hora establecida', key: 'scheduled_entry_time', width: 16 },
  { header: 'Hora real', key: 'actual_arrival_time', width: 12 },
  { header: 'Min. atraso', key: 'late_minutes', width: 12 },
  { header: 'Observacion', key: 'summary', width: 34 },
  { header: 'Usuario', key: 'registered_by', width: 18 },
  { header: 'Actualizado', key: 'updated_at', width: 20 }
];

historyRouter.get('/', async (req, res, next) => {
  try {
    const data = await buildHistoryData(req.query);
    res.render('history/index', { title: 'Historial', ...data });
  } catch (error) {
    next(error);
  }
});

historyRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await buildHistoryData(req.query);
    await sendExcel(res, 'historial-asistencia', 'Historial', historyColumns, data.records);
  } catch (error) {
    next(error);
  }
});

historyRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await buildHistoryData(req.query);
    sendPdf(res, 'historial-asistencia', 'Historial de asistencia', historyColumns, data.records);
  } catch (error) {
    next(error);
  }
});

async function buildHistoryData(query) {
  const filters = {
    worker_id: clean(query.worker_id),
    date: clean(query.date),
    from: clean(query.from),
    to: clean(query.to),
    month: clean(query.month),
    branch: clean(query.branch),
    status: clean(query.status)
  };
  const workers = (await listWorkers()).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
  const records = (await listAttendance())
    .map((record) => {
      const worker = workerMap.get(record.worker_id) || {};
      const summary = record.observation || record.justified_reason || record.permit_reason || '';
      return { ...record, full_name: worker.full_name || 'Trabajador no encontrado', cedula: worker.cedula || '', branch: worker.branch || '', summary };
    })
    .filter((record) => matchesFilters(record, filters))
    .sort((a, b) => b.record_date.localeCompare(a.record_date) || a.full_name.localeCompare(b.full_name));
  const branches = [...new Set(workers.map((worker) => worker.branch).filter(Boolean))].sort().map((branch) => ({ branch }));
  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  return { records, workers, branches, statuses: attendanceStatuses, filters, exportQuery };
}

function matchesFilters(record, filters) {
  if (filters.worker_id && record.worker_id !== filters.worker_id) return false;
  if (filters.date && record.record_date !== filters.date) return false;
  if (filters.from && record.record_date < filters.from) return false;
  if (filters.to && record.record_date > filters.to) return false;
  if (filters.month && record.record_date.slice(0, 7) !== filters.month) return false;
  if (filters.branch && record.branch !== filters.branch) return false;
  if (filters.status && record.status !== filters.status) return false;
  return true;
}
