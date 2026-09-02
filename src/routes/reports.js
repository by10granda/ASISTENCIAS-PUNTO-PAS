import { Router } from 'express';
import { sendExcel, sendPdf } from '../exporters.js';
import { listAttendance, listWorkers } from '../sheetsStore.js';
import { currentMonth, monthRange } from '../utils.js';

export const reportsRouter = Router();

const reportColumns = [
  { header: 'Trabajador', key: 'full_name', width: 28 },
  { header: 'Cedula', key: 'cedula', width: 16 },
  { header: 'Sucursal', key: 'branch', width: 18 },
  { header: 'Dias trabajados', key: 'worked_days', width: 16 },
  { header: 'F. justificadas', key: 'justified_absences', width: 16 },
  { header: 'F. injustificadas', key: 'unjustified_absences', width: 18 },
  { header: 'Atrasos', key: 'late_count', width: 12 },
  { header: 'Min. atraso', key: 'late_minutes', width: 14 },
  { header: 'Vacaciones', key: 'vacation_days', width: 14 },
  { header: 'Permisos', key: 'permits', width: 12 }
];

reportsRouter.get('/', async (req, res, next) => {
  try {
    const data = await buildReportData(req.query);
    res.render('reports/index', { title: 'Reportes', ...data });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await buildReportData(req.query);
    await sendExcel(res, `reporte-asistencia-${data.start}-${data.end}`, 'Reporte', reportColumns, data.report);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await buildReportData(req.query);
    sendPdf(res, `reporte-asistencia-${data.start}-${data.end}`, `Reporte de asistencia ${data.start} a ${data.end}`, reportColumns, data.report);
  } catch (error) {
    next(error);
  }
});

async function buildReportData(query) {
  const month = currentMonth();
  const workerId = query.worker_id || '';
  const monthDates = monthRange(month);
  const start = query.from || monthDates.start;
  const end = query.to || monthDates.end;
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
  const exportQuery = new URLSearchParams({ worker_id: workerId, from: start, to: end }).toString();
  return { month, workerId, start, end, workers, report, totals, exportQuery };
}

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
