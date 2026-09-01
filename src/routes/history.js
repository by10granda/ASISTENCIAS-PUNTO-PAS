import { Router } from 'express';
import { listAttendance, listWorkers } from '../sheetsStore.js';
import { attendanceStatuses, clean } from '../utils.js';

export const historyRouter = Router();

historyRouter.get('/', async (req, res, next) => {
  try {
    const filters = {
      worker_id: clean(req.query.worker_id),
      date: clean(req.query.date),
      from: clean(req.query.from),
      to: clean(req.query.to),
      month: clean(req.query.month),
      branch: clean(req.query.branch),
      status: clean(req.query.status)
    };
    const workers = (await listWorkers()).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
    const records = (await listAttendance())
      .map((record) => {
        const worker = workerMap.get(record.worker_id) || {};
        return { ...record, full_name: worker.full_name || 'Trabajador no encontrado', cedula: worker.cedula || '', branch: worker.branch || '' };
      })
      .filter((record) => matchesFilters(record, filters))
      .sort((a, b) => b.record_date.localeCompare(a.record_date) || a.full_name.localeCompare(b.full_name));
    const branches = [...new Set(workers.map((worker) => worker.branch).filter(Boolean))].sort().map((branch) => ({ branch }));
    res.render('history/index', { title: 'Historial', records, workers, branches, statuses: attendanceStatuses, filters });
  } catch (error) {
    next(error);
  }
});

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
