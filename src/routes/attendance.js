import { Router } from 'express';
import { findWorker, listAttendance, listBranches, listWorkers, upsertAttendance } from '../store.js';
import { attendanceStatuses, clean, minutesBetween, requireText, today } from '../utils.js';

export const attendanceRouter = Router();

attendanceRouter.get('/', async (req, res, next) => {
  try {
    const date = clean(req.query.date) || today();
    const branch = clean(req.query.branch);
    const { branches, workers, records } = await attendanceViewData(date, branch);
    res.render('attendance/index', { title: 'Registro de asistencia', date, branch, branches, workers, records, statuses: attendanceStatuses, errors: [] });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/', async (req, res, next) => {
  try {
    const record = normalizeAttendance(req.body);
    const errors = await validateAttendance(record);
    if (errors.length) return await renderAttendanceWithErrors(res, record.record_date, errors);

    await upsertAttendance(record);
    const branchQuery = clean(req.body.branch) ? `&branch=${encodeURIComponent(clean(req.body.branch))}` : '';
    res.redirect(`/asistencia?date=${record.record_date}${branchQuery}`);
  } catch (error) {
    next(error);
  }
});

async function renderAttendanceWithErrors(res, date, errors, branch = '') {
  const data = await attendanceViewData(date, branch);
  res.status(422).render('attendance/index', { title: 'Registro de asistencia', date, branch, branches: data.branches, ...data, statuses: attendanceStatuses, errors });
}

async function attendanceViewData(date, branch) {
  const [branches, allWorkers, allRecords] = await Promise.all([listBranches(), listWorkers(), listAttendance()]);
  const workers = allWorkers
    .filter((worker) => worker.status === 'Activo')
    .filter((worker) => !branch || worker.branch === branch)
    .sort(byName);
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const workerBranch = new Map(allWorkers.map((worker) => [worker.id, worker.branch]));
  const records = allRecords
    .filter((record) => record.record_date === date)
    .filter((record) => !branch || workerBranch.get(record.worker_id) === branch)
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const branchNames = [...new Set([...branches.map((branch) => branch.name), ...allWorkers.map((worker) => worker.branch)])].filter(Boolean).sort();
  return { branches: branchNames, workers, records };
}

function normalizeAttendance(body) {
  const status = clean(body.status);
  const scheduled = clean(body.scheduled_entry_time);
  const actual = clean(body.actual_arrival_time);
  return {
    worker_id: clean(body.worker_id),
    record_date: clean(body.record_date),
    status,
    entry_time: clean(body.entry_time),
    scheduled_entry_time: scheduled,
    actual_arrival_time: actual,
    late_minutes: status === 'ATRASO' ? minutesBetween(scheduled, actual) : 0,
    observation: clean(body.observation),
    registered_by: clean(body.registered_by) || 'Administrador',
    justified_reason: status === 'FALTA JUSTIFICADA' ? clean(body.justified_reason) : '',
    has_support_doc: body.has_support_doc ? 1 : 0,
    permit_time_out: status === 'PERMISO' ? clean(body.permit_time_out) : '',
    permit_time_return: status === 'PERMISO' ? clean(body.permit_time_return) : '',
    permit_reason: status === 'PERMISO' ? clean(body.permit_reason) : '',
    permit_full_day: status === 'PERMISO' && body.permit_full_day ? 1 : 0
  };
}

async function validateAttendance(record) {
  const errors = [];
  if (!record.worker_id || !(await findWorker(record.worker_id))) errors.push('Seleccione un trabajador valido.');
  if (!requireText(record.record_date)) errors.push('Seleccione la fecha.');
  if (!attendanceStatuses.includes(record.status)) errors.push('Seleccione un estado valido.');
  if (!requireText(record.registered_by)) errors.push('Ingrese el usuario que registra.');
  if (record.status === 'ASISTENCIA NORMAL' && !requireText(record.entry_time)) errors.push('Ingrese la hora de entrada.');
  if (record.status === 'FALTA JUSTIFICADA' && !requireText(record.justified_reason)) errors.push('Ingrese el motivo de la falta justificada.');
  if (record.status === 'ATRASO' && (!requireText(record.scheduled_entry_time) || !requireText(record.actual_arrival_time))) errors.push('Ingrese la hora establecida y la hora real de llegada.');
  if (record.status === 'PERMISO' && !requireText(record.permit_reason)) errors.push('Ingrese el motivo del permiso.');
  return errors;
}

function byName(a, b) {
  return a.full_name.localeCompare(b.full_name);
}
