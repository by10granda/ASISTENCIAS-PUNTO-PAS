import { Router } from 'express';
import { createWorker, findWorker, listWorkers, updateWorker } from '../sheetsStore.js';
import { clean, requireText } from '../utils.js';

export const workersRouter = Router();

workersRouter.get('/', async (req, res, next) => {
  try {
    const q = clean(req.query.q).toLowerCase();
    const workers = (await listWorkers())
      .filter((worker) => !q || [worker.full_name, worker.cedula, worker.position, worker.branch].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => `${a.status}-${a.full_name}`.localeCompare(`${b.status}-${b.full_name}`));
    res.render('workers/index', { title: 'Trabajadores', workers, q: clean(req.query.q) });
  } catch (error) {
    next(error);
  }
});

workersRouter.get('/new', (req, res) => {
  res.render('workers/form', { title: 'Registrar trabajador', worker: {}, errors: [], action: '/trabajadores' });
});

workersRouter.post('/', async (req, res, next) => {
  const worker = normalizeWorker(req.body);
  const errors = validateWorker(worker);
  if (errors.length) return res.status(422).render('workers/form', { title: 'Registrar trabajador', worker, errors, action: '/trabajadores' });

  try {
    await createWorker(worker);
    res.redirect('/trabajadores');
  } catch (error) {
    if (error.message === 'DUPLICATE_CEDULA') {
      errors.push('Ya existe un trabajador con esa cedula.');
      return res.status(422).render('workers/form', { title: 'Registrar trabajador', worker, errors, action: '/trabajadores' });
    }
    next(error);
  }
});

workersRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const worker = await findWorker(req.params.id);
    if (!worker) return res.status(404).render('error', { title: 'No encontrado', message: 'Trabajador no encontrado.' });
    res.render('workers/form', { title: 'Editar trabajador', worker, errors: [], action: `/trabajadores/${worker.id}` });
  } catch (error) {
    next(error);
  }
});

workersRouter.post('/:id', async (req, res, next) => {
  try {
    const existing = await findWorker(req.params.id);
    if (!existing) return res.status(404).render('error', { title: 'No encontrado', message: 'Trabajador no encontrado.' });

    const worker = { ...normalizeWorker(req.body), id: req.params.id };
    const errors = validateWorker(worker);
    if (errors.length) return res.status(422).render('workers/form', { title: 'Editar trabajador', worker, errors, action: `/trabajadores/${worker.id}` });

    await updateWorker(req.params.id, worker);
    res.redirect('/trabajadores');
  } catch (error) {
    if (error.message === 'DUPLICATE_CEDULA') {
      const worker = { ...normalizeWorker(req.body), id: req.params.id };
      const errors = ['Ya existe otro trabajador con esa cedula.'];
      return res.status(422).render('workers/form', { title: 'Editar trabajador', worker, errors, action: `/trabajadores/${worker.id}` });
    }
    next(error);
  }
});

function normalizeWorker(body) {
  return {
    full_name: clean(body.full_name),
    cedula: clean(body.cedula),
    position: clean(body.position),
    branch: clean(body.branch),
    hire_date: clean(body.hire_date),
    status: body.status === 'Inactivo' ? 'Inactivo' : 'Activo'
  };
}

function validateWorker(worker) {
  const errors = [];
  if (!requireText(worker.full_name)) errors.push('Ingrese nombres y apellidos.');
  if (!requireText(worker.cedula)) errors.push('Ingrese la cedula.');
  if (!requireText(worker.position)) errors.push('Ingrese el cargo.');
  if (!requireText(worker.branch)) errors.push('Ingrese la sucursal o area.');
  if (!requireText(worker.hire_date)) errors.push('Ingrese la fecha de ingreso.');
  return errors;
}
