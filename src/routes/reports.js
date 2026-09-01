import { Router } from 'express';
import { listAttendance, listWorkers } from '../sheetsStore.js';
import { currentMonth, monthRange } from '../utils.js';

export const reportsRouter = Router();

reportsRouter.get('/', async (req, res, next) => {
  try {
    const month = req.query.month || currentMonth();
    const workerId = req.query.worker_id || '';
    const { start, end } = monthRange(month);
    const workers = (await listWorkers()).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const records = (await listAttendance()).filter((record) => record.record_date >= start && record.record_date <= end);
    const reportWorkers = workerId ? workers.filter((worker) => worker.id === workerId) : workers;
    const report = reportWorkers.map((worker) => buildWorkerReport(worker, records.filter((record) => record.worker_id === worker.id)));
    const totals = {
      records: records.length,
      unjustified_absences: records.filter((record) => record.status === 'FALTA INJUSTIFICADA').length,
      late_count: records.filter((record) => record.status === 'ATRASO').length,
      late_minutes: records.reduce((sum, record) => sum + (record.status === 'ATRASO' ? Number(record.late_minutes) || 0 : 0), 0)
    };
    res.render('reports/index', { title: 'Reportes', month, workerId, workers, report, totals });
  } catch (error) {
    next(error);
  }
});

function buildWorkerReport(worker, records) {
  return {
    id: worker.id,
    full_name: worker.full_name,
    cedula: worker.cedula,
    branch: worker.branch,
    worked_days: count(records, 'ASISTENCIA NORMAL'),
    justified_absences: count(records, 'FALTA JUSTIFICADA'),
    unjustified_absences: count(records, 'FALTA INJUSTIFICADA'),
    late_count: count(records, 'ATRASO'),
    late_minutes: records.reduce((sum, record) => sum + (record.status === 'ATRASO' ? Number(record.late_minutes) || 0 : 0), 0),
    vacation_days: count(records, 'VACACIONES'),
    permits: count(records, 'PERMISO')
  };
}

function count(records, status) {
  return records.filter((record) => record.status === status).length;
}
