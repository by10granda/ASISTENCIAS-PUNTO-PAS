import { Router } from 'express';
import { sendExcel, sendPdf } from '../exporters.js';
import {
  createAttentionCall,
  createJobAbandonment,
  createMedicalWithdrawal,
  findWorker,
  listAttendance,
  listAttentionCalls,
  listJobAbandonments,
  listMedicalWithdrawals,
  listWorkers
} from '../store.js';
import { clean, requireText, today } from '../utils.js';

export const incidentsRouter = Router();

const incidentColumns = [
  { header: 'Tipo', key: 'type', width: 22 },
  { header: 'Fecha', key: 'record_date', width: 14 },
  { header: 'Trabajador', key: 'full_name', width: 28 },
  { header: 'Hora salida', key: 'exit_time', width: 12 },
  { header: 'Motivo', key: 'reason', width: 28 },
  { header: 'Detalle', key: 'detail', width: 36 },
  { header: 'Observacion', key: 'observation', width: 30 },
  { header: 'Usuario', key: 'registered_by', width: 18 },
  { header: 'Registrado', key: 'created_at', width: 20 }
];

incidentsRouter.get('/', async (req, res, next) => {
  try {
    const branch = clean(req.query.branch);
    const data = await incidentViewData(branch);
    res.render('incidents/index', { title: 'Novedades', branch, ...data, errors: [] });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await incidentViewData(clean(req.query.branch));
    sendExcel(res, 'novedades-trabajadores', 'Novedades de trabajadores', incidentColumns, buildExportRows(data));
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await incidentViewData(clean(req.query.branch));
    sendPdf(res, 'novedades-trabajadores', 'Novedades de trabajadores', incidentColumns, buildExportRows(data));
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/llamados', async (req, res, next) => {
  try {
    const record = {
      worker_id: clean(req.body.worker_id),
      record_date: clean(req.body.record_date),
      reason: clean(req.body.reason),
      description: clean(req.body.description),
      registered_by: clean(req.body.registered_by) || 'Administrador'
    };
    const errors = await validateAttentionCall(record);
    if (errors.length) {
      const data = await incidentViewData(clean(req.body.branch));
      return res.status(422).render('incidents/index', { title: 'Novedades', branch: clean(req.body.branch), ...data, errors });
    }

    await createAttentionCall(record);
    res.redirect('/novedades');
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/abandonos', async (req, res, next) => {
  try {
    const record = {
      worker_id: clean(req.body.worker_id),
      record_date: clean(req.body.record_date),
      exit_time: clean(req.body.exit_time),
      reason: clean(req.body.reason),
      observation: clean(req.body.observation),
      registered_by: clean(req.body.registered_by) || 'Administrador'
    };
    const errors = await validateJobAbandonment(record);
    if (errors.length) {
      const data = await incidentViewData(clean(req.body.branch));
      return res.status(422).render('incidents/index', { title: 'Novedades', branch: clean(req.body.branch), ...data, errors });
    }

    await createJobAbandonment(record);
    res.redirect('/novedades');
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/retiros', async (req, res, next) => {
  try {
    const record = {
      worker_id: clean(req.body.worker_id),
      record_date: clean(req.body.record_date),
      exit_time: clean(req.body.exit_time),
      cause: ['Accidente laboral', 'Enfermedad'].includes(req.body.cause) ? req.body.cause : '',
      description: clean(req.body.description),
      has_support_doc: req.body.has_support_doc ? 1 : 0,
      registered_by: clean(req.body.registered_by) || 'Administrador'
    };
    const errors = await validateMedicalWithdrawal(record);
    if (errors.length) {
      const data = await incidentViewData(clean(req.body.branch));
      return res.status(422).render('incidents/index', { title: 'Novedades', branch: clean(req.body.branch), ...data, errors });
    }

    await createMedicalWithdrawal(record);
    res.redirect('/novedades');
  } catch (error) {
    next(error);
  }
});

async function incidentViewData(branchFilter = '') {
  const [workers, allWorkers, attendanceRecords, attentionCallRows, jobAbandonmentRows, medicalWithdrawalRows] = await Promise.all([
    listWorkers(), listWorkers(), listAttendance(), listAttentionCalls(), listJobAbandonments(), listMedicalWithdrawals()
  ]);
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const matchBranch = (workerId) => {
    const worker = workerMap.get(workerId);
    return !branchFilter || (worker && worker.branch === branchFilter);
  };
  const activeWorkers = workers
    .filter((worker) => worker.status === 'Activo')
    .filter((worker) => !branchFilter || worker.branch === branchFilter)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const branches = [...new Set(allWorkers.map((worker) => worker.branch).filter(Boolean))].sort();
  const attendances = attendanceRecords
    .filter((record) => record.status === 'FALTA JUSTIFICADA')
    .filter((record) => matchBranch(record.worker_id))
    .map((record) => ({
      ...record,
      full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado',
      branch: workerMap.get(record.worker_id)?.branch || ''
    }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date) || a.full_name.localeCompare(b.full_name));
  const attentionCalls = attentionCallRows
    .filter((record) => matchBranch(record.worker_id))
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  const jobAbandonments = jobAbandonmentRows
    .filter((record) => matchBranch(record.worker_id))
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  const medicalWithdrawals = medicalWithdrawalRows
    .filter((record) => matchBranch(record.worker_id))
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  return { workers, branches, attendances, attentionCalls, jobAbandonments, medicalWithdrawals, today: today() };
}

async function validateAttentionCall(record) {
  const errors = [];
  if (!record.worker_id || !(await findWorker(record.worker_id))) errors.push('Seleccione un trabajador valido para el llamado de atencion.');
  if (!requireText(record.record_date)) errors.push('Ingrese la fecha del llamado de atencion.');
  if (!requireText(record.reason)) errors.push('Ingrese el motivo del llamado de atencion.');
  if (!requireText(record.description)) errors.push('Ingrese la descripcion del llamado de atencion.');
  return errors;
}

async function validateJobAbandonment(record) {
  const errors = [];
  if (!record.worker_id || !(await findWorker(record.worker_id))) errors.push('Seleccione un trabajador valido para el abandono de trabajo.');
  if (!requireText(record.record_date)) errors.push('Ingrese la fecha del abandono de trabajo.');
  if (!requireText(record.reason)) errors.push('Ingrese el motivo o detalle del abandono de trabajo.');
  return errors;
}

async function validateMedicalWithdrawal(record) {
  const errors = [];
  if (!record.worker_id || !(await findWorker(record.worker_id))) errors.push('Seleccione un trabajador valido para el retiro.');
  if (!requireText(record.record_date)) errors.push('Ingrese la fecha del retiro.');
  if (!requireText(record.cause)) errors.push('Seleccione si el retiro fue por accidente laboral o enfermedad.');
  if (!requireText(record.description)) errors.push('Ingrese el detalle del retiro.');
  return errors;
}

function buildExportRows(data) {
  const attentionRows = data.attentionCalls.map((record) => ({
    type: 'Llamado de atencion',
    record_date: record.record_date,
    full_name: record.full_name,
    exit_time: '',
    reason: record.reason,
    detail: record.description,
    observation: '',
    registered_by: record.registered_by,
    created_at: record.created_at
  }));
  const abandonmentRows = data.jobAbandonments.map((record) => ({
    type: 'Abandono de trabajo',
    record_date: record.record_date,
    full_name: record.full_name,
    exit_time: record.exit_time,
    reason: record.reason,
    detail: record.reason,
    observation: record.observation,
    registered_by: record.registered_by,
    created_at: record.created_at
  }));
  const withdrawalRows = data.medicalWithdrawals.map((record) => ({
    type: `Retiro por ${record.cause}`,
    record_date: record.record_date,
    full_name: record.full_name,
    exit_time: record.exit_time,
    reason: record.cause,
    detail: record.description,
    observation: record.has_support_doc ? 'Con documento de respaldo' : 'Sin documento de respaldo',
    registered_by: record.registered_by,
    created_at: record.created_at
  }));
  return [...attentionRows, ...abandonmentRows, ...withdrawalRows].sort((a, b) => b.record_date.localeCompare(a.record_date) || a.full_name.localeCompare(b.full_name));
}
