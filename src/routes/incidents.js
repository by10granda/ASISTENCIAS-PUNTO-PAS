import { Router } from 'express';
import {
  createAttentionCall,
  createJobAbandonment,
  findWorker,
  listAttentionCalls,
  listJobAbandonments,
  listWorkers
} from '../sheetsStore.js';
import { clean, requireText, today } from '../utils.js';

export const incidentsRouter = Router();

incidentsRouter.get('/', async (req, res, next) => {
  try {
    const data = await incidentViewData();
    res.render('incidents/index', { title: 'Novedades', ...data, errors: [] });
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
      const data = await incidentViewData();
      return res.status(422).render('incidents/index', { title: 'Novedades', ...data, errors });
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
      const data = await incidentViewData();
      return res.status(422).render('incidents/index', { title: 'Novedades', ...data, errors });
    }

    await createJobAbandonment(record);
    res.redirect('/novedades');
  } catch (error) {
    next(error);
  }
});

async function incidentViewData() {
  const workers = (await listWorkers()).filter((worker) => worker.status === 'Activo').sort((a, b) => a.full_name.localeCompare(b.full_name));
  const allWorkers = await listWorkers();
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const attentionCalls = (await listAttentionCalls())
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  const jobAbandonments = (await listJobAbandonments())
    .map((record) => ({ ...record, full_name: workerMap.get(record.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  return { workers, attentionCalls, jobAbandonments, today: today() };
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
