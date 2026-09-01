import { Router } from 'express';
import { findWorker, listAttendance, listWorkers, upsertAttendance } from '../sheetsStore.js';
import { attendanceStatuses, clean, minutesBetween, requireText, today } from '../utils.js';

export const attendanceRouter = Router();

attendanceRouter.get('/', async (req, res, next) => {
  try {
    const date = clean(req.query.date) || today();
    const { workers, records } = await attendanceViewData(date);
    res.render('attendance/index', { title: 'Registro de asistencia', date, workers, records, statuses: attendanceStatuses, errors: [] });
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
    res.redirect(`/asistencia?date=${record.record_date}`);
  } catch (error) {
    next(error);
  }
});

async function renderAttendanceWithErrors(res, date, errors) {
  const data = await attendanceViewData(date);
  res.status(422).render('attendance/index', { title: 'Registro de asistencia', date, ...data, statuses: attendanceStatuses, errors });
}

async function attendanceViewData(date) {
  const workers = (await listWorkers()).filter((worker) => worker.status === 'Activo').sort(byName);
  const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
  const records = (await listAttendance())
    .filter((record) => record.record_date === date)
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { workers, records };
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
