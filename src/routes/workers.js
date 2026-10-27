import { Router } from 'express';
import { buildBranchNames, includesBranch } from '../branchCatalog.js';
import { createBranch, createWorker, deleteWorkerAndData, findWorker, listBranches, listWorkers, updateWorker } from '../sheetsStore.js';
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

workersRouter.get('/new', async (req, res, next) => {
  try {
    await renderWorkerForm(res, { title: 'Registrar trabajador', worker: {}, errors: branchErrors(req), action: '/trabajadores' });
  } catch (error) {
    next(error);
  }
});

workersRouter.post('/', async (req, res, next) => {
  try {
    const worker = normalizeWorker(req.body);
    const branches = await listBranchNames();
    const errors = validateWorker(worker, branches);
    if (errors.length) return await renderWorkerForm(res, { status: 422, title: 'Registrar trabajador', worker, errors, action: '/trabajadores', branches });

    await createWorker(worker);
    res.redirect('/trabajadores');
  } catch (error) {
    if (error.message === 'DUPLICATE_CEDULA') {
      const worker = normalizeWorker(req.body);
      return await renderWorkerForm(res, { status: 422, title: 'Registrar trabajador', worker, errors: ['Ya existe un trabajador con esa cedula.'], action: '/trabajadores' });
    }
    next(error);
  }
});

workersRouter.post('/branches', async (req, res, next) => {
  const returnTo = safeWorkerFormPath(req.body.return_to);
  try {
    const name = clean(req.body.branch_name);
    const branches = await listBranchNames();
    if (!requireText(name)) return res.redirect(`${returnTo}?branch_error=${encodeURIComponent('Ingrese el nombre de la sucursal o area.')}`);
    if (includesBranch(branches, name)) return res.redirect(`${returnTo}?branch_error=${encodeURIComponent('La sucursal o area ya existe.')}`);
    await createBranch(name);
    res.redirect(returnTo);
  } catch (error) {
    if (error.message === 'DUPLICATE_BRANCH') return res.redirect(`${returnTo}?branch_error=${encodeURIComponent('La sucursal o area ya existe.')}`);
    next(error);
  }
});

workersRouter.get('/:id/edit', async (req, res, next) => {
  try {
    const worker = await findWorker(req.params.id);
    if (!worker) return res.status(404).render('error', { title: 'No encontrado', message: 'Trabajador no encontrado.' });
    await renderWorkerForm(res, { title: 'Editar trabajador', worker, errors: branchErrors(req), action: `/trabajadores/${worker.id}` });
  } catch (error) {
    next(error);
  }
});

workersRouter.post('/:id', async (req, res, next) => {
  try {
    const existing = await findWorker(req.params.id);
    if (!existing) return res.status(404).render('error', { title: 'No encontrado', message: 'Trabajador no encontrado.' });

    const worker = { ...normalizeWorker(req.body), id: req.params.id };
    const branches = await listBranchNames();
    const errors = validateWorker(worker, branches);
    if (errors.length) return await renderWorkerForm(res, { status: 422, title: 'Editar trabajador', worker, errors, action: `/trabajadores/${worker.id}`, branches });

    await updateWorker(req.params.id, worker);
    res.redirect('/trabajadores');
  } catch (error) {
    if (error.message === 'DUPLICATE_CEDULA') {
      const worker = { ...normalizeWorker(req.body), id: req.params.id };
      const errors = ['Ya existe otro trabajador con esa cedula.'];
      return await renderWorkerForm(res, { status: 422, title: 'Editar trabajador', worker, errors, action: `/trabajadores/${worker.id}` });
    }
    next(error);
  }
});

workersRouter.post('/:id/delete', async (req, res, next) => {
  try {
    const worker = await findWorker(req.params.id);
    if (!worker) return res.status(404).render('error', { title: 'No encontrado', message: 'Trabajador no encontrado.' });
    if (clean(req.body.confirm_delete) !== 'ELIMINAR') {
      const errors = ['Para eliminar definitivamente debe escribir la palabra ELIMINAR.'];
      return await renderWorkerForm(res, { status: 422, title: 'Editar trabajador', worker, errors, action: `/trabajadores/${worker.id}` });
    }

    await deleteWorkerAndData(worker.id);
    res.redirect('/trabajadores');
  } catch (error) {
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

function validateWorker(worker, branches) {
  const errors = [];
  if (!requireText(worker.full_name)) errors.push('Ingrese nombres y apellidos.');
  if (!requireText(worker.cedula)) errors.push('Ingrese la cedula.');
  if (!requireText(worker.position)) errors.push('Ingrese el cargo.');
  if (!requireText(worker.branch) || !branches.includes(worker.branch)) errors.push('Seleccione una sucursal o area valida.');
  if (!requireText(worker.hire_date)) errors.push('Ingrese la fecha de ingreso.');
  return errors;
}

async function listBranchNames() {
  const [workers, branches] = await Promise.all([listWorkers(), listBranches()]);
  return buildBranchNames(workers, branches);
}

async function renderWorkerForm(res, { status = 200, title, worker, errors, action, branches }) {
  const branchOptions = branches || await listBranchNames();
  return res.status(status).render('workers/form', { title, worker, errors, action, branches: branchOptions });
}

function branchErrors(req) {
  const message = clean(req.query.branch_error);
  return message ? [message] : [];
}

function safeWorkerFormPath(value) {
  const path = clean(value);
  return path === '/trabajadores/new' || /^\/trabajadores\/[^/]+\/edit$/.test(path) ? path : '/trabajadores/new';
}
