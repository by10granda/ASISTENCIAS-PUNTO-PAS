import { Router } from 'express';
import { createVacation, findWorker, listVacations, listWorkers } from '../store.js';
import { clean, daysInclusive, isValidDate, requireText, today } from '../utils.js';
import { vacationBalance } from '../vacationPolicy.js';

export const vacationsRouter = Router();

vacationsRouter.get('/', async (req, res, next) => {
  try {
    const branch = clean(req.query.branch);
    const data = await vacationViewData(branch);
    res.render('vacations/index', { title: 'Vacaciones', branch, ...data, errors: [] });
  } catch (error) {
    next(error);
  }
});

vacationsRouter.post('/', async (req, res, next) => {
  try {
    const vacation = {
      worker_id: clean(req.body.worker_id),
      start_date: clean(req.body.start_date),
      end_date: clean(req.body.end_date),
      total_days: daysInclusive(req.body.start_date, req.body.end_date),
      observation: clean(req.body.observation),
      status: ['Programadas', 'En curso', 'Finalizadas'].includes(req.body.status) ? req.body.status : 'Programadas'
    };
    const errors = [];
    const worker = vacation.worker_id ? await findWorker(vacation.worker_id) : null;
    if (!worker) errors.push('Seleccione un trabajador valido.');
    if (!isValidDate(vacation.start_date) || !isValidDate(vacation.end_date) || vacation.total_days <= 0) errors.push('Ingrese un rango de fechas valido.');
    if (worker && vacation.start_date < worker.hire_date) errors.push('Las vacaciones no pueden iniciar antes de la fecha de ingreso.');

    const vacations = await listVacations();
    const overlaps = vacations.some((item) => item.worker_id === vacation.worker_id
      && item.end_date >= vacation.start_date && item.start_date <= vacation.end_date);
    if (vacation.total_days > 0 && overlaps) errors.push('El trabajador ya tiene vacaciones registradas dentro de este rango.');
    if (worker) {
      const balance = vacationBalance(worker, vacations, [], today());
      if (vacation.total_days > balance.available_days) errors.push(`El trabajador solo tiene ${balance.available_days} dias disponibles.`);
    }

    if (errors.length) {
      const branch = clean(req.body.branch);
      const data = await vacationViewData(branch);
      return res.status(422).render('vacations/index', { title: 'Vacaciones', branch, ...data, errors });
    }

    await createVacation(vacation);
    res.redirect('/vacaciones');
  } catch (error) {
    next(error);
  }
});

async function vacationViewData(branchFilter = '') {
  const [allWorkers, vacationRows] = await Promise.all([listWorkers(), listVacations()]);
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const branches = [...new Set(allWorkers.map((worker) => worker.branch).filter(Boolean))].sort();
  const matchBranch = (workerId) => {
    const worker = workerMap.get(workerId);
    return !branchFilter || (worker && worker.branch === branchFilter);
  };
  const workers = allWorkers
    .filter((worker) => worker.status === 'Activo')
    .filter((worker) => !branchFilter || worker.branch === branchFilter)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const vacations = vacationRows
    .filter((vacation) => matchBranch(vacation.worker_id))
    .map((vacation) => ({ ...vacation, full_name: workerMap.get(vacation.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const balanceDate = today();
  const balances = allWorkers
    .filter((worker) => !branchFilter || worker.branch === branchFilter)
    .map((worker) => ({ ...worker, ...vacationBalance(worker, vacationRows, [], balanceDate) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { branches, vacations, balances, workers, balanceDate };
}
