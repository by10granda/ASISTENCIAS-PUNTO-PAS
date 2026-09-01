import { Router } from 'express';
import { createVacation, findWorker, listVacations, listWorkers } from '../sheetsStore.js';
import { clean, daysInclusive, requireText } from '../utils.js';

export const vacationsRouter = Router();

vacationsRouter.get('/', async (req, res, next) => {
  try {
    const data = await vacationViewData();
    res.render('vacations/index', { title: 'Vacaciones', ...data, errors: [] });
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
    if (!vacation.worker_id || !(await findWorker(vacation.worker_id))) errors.push('Seleccione un trabajador valido.');
    if (!requireText(vacation.start_date) || !requireText(vacation.end_date) || vacation.total_days <= 0) errors.push('Ingrese un rango de fechas valido.');

    if (errors.length) {
      const data = await vacationViewData();
      return res.status(422).render('vacations/index', { title: 'Vacaciones', ...data, errors });
    }

    await createVacation(vacation);
    res.redirect('/vacaciones');
  } catch (error) {
    next(error);
  }
});

async function vacationViewData() {
  const allWorkers = await listWorkers();
  const workers = allWorkers.filter((worker) => worker.status === 'Activo').sort((a, b) => a.full_name.localeCompare(b.full_name));
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const vacations = (await listVacations())
    .map((vacation) => ({ ...vacation, full_name: workerMap.get(vacation.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  return { vacations, workers };
}
