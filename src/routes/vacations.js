import { Router } from 'express';
import { createVacation, createVacationDeduction, findWorker, listVacationDeductions, listVacations, listWorkers } from '../sheetsStore.js';
import { clean, daysInclusive, isValidDate, requireText, today } from '../utils.js';
import { vacationBalance } from '../vacationPolicy.js';

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
    const worker = vacation.worker_id ? await findWorker(vacation.worker_id) : null;
    if (!worker) errors.push('Seleccione un trabajador valido.');
    if (!isValidDate(vacation.start_date) || !isValidDate(vacation.end_date) || vacation.total_days <= 0) errors.push('Ingrese un rango de fechas valido.');
    if (worker && vacation.start_date < worker.hire_date) errors.push('Las vacaciones no pueden iniciar antes de la fecha de ingreso.');

    const [vacations, deductions] = await Promise.all([listVacations(), listVacationDeductions()]);
    const overlaps = vacations.some((item) => item.worker_id === vacation.worker_id
      && item.end_date >= vacation.start_date && item.start_date <= vacation.end_date);
    if (vacation.total_days > 0 && overlaps) errors.push('El trabajador ya tiene vacaciones registradas dentro de este rango.');
    if (worker) {
      const balance = vacationBalance(worker, vacations, deductions, today());
      if (vacation.total_days > balance.available_days) errors.push(`El trabajador solo tiene ${balance.available_days} dias disponibles.`);
    }

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

vacationsRouter.post('/bajas', async (req, res, next) => {
  try {
    const deduction = {
      worker_id: clean(req.body.worker_id),
      days: Number(req.body.days),
      reason: clean(req.body.reason),
      record_date: clean(req.body.record_date),
      registered_by: clean(req.body.registered_by)
    };
    const errors = [];
    const worker = deduction.worker_id ? await findWorker(deduction.worker_id) : null;
    if (!worker) errors.push('Seleccione un trabajador valido para la baja.');
    if (!Number.isInteger(deduction.days) || deduction.days <= 0) errors.push('Ingrese una cantidad valida de dias para dar de baja.');
    if (!requireText(deduction.reason)) errors.push('Ingrese el motivo de la baja.');
    if (!requireText(deduction.registered_by)) errors.push('Ingrese el responsable de la baja.');
    if (!isValidDate(deduction.record_date) || deduction.record_date > today()) errors.push('Ingrese una fecha valida para la baja.');
    if (worker && deduction.record_date < worker.hire_date) errors.push('La baja no puede ser anterior a la fecha de ingreso.');

    if (worker && Number.isInteger(deduction.days) && deduction.days > 0) {
      const [vacations, deductions] = await Promise.all([listVacations(), listVacationDeductions()]);
      const balance = vacationBalance(worker, vacations, deductions, today());
      if (deduction.days > balance.available_days) errors.push(`El trabajador solo tiene ${balance.available_days} dias disponibles.`);
    }

    if (errors.length) {
      const data = await vacationViewData();
      return res.status(422).render('vacations/index', { title: 'Vacaciones', ...data, errors });
    }

    await createVacationDeduction(deduction);
    res.redirect('/vacaciones');
  } catch (error) {
    next(error);
  }
});

async function vacationViewData() {
  const [allWorkers, vacationRows, deductionRows] = await Promise.all([listWorkers(), listVacations(), listVacationDeductions()]);
  const workers = allWorkers.filter((worker) => worker.status === 'Activo').sort((a, b) => a.full_name.localeCompare(b.full_name));
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const vacations = vacationRows
    .map((vacation) => ({ ...vacation, full_name: workerMap.get(vacation.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const deductions = deductionRows
    .map((deduction) => ({ ...deduction, full_name: workerMap.get(deduction.worker_id)?.full_name || 'Trabajador no encontrado' }))
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  const balanceDate = today();
  const balances = allWorkers
    .map((worker) => ({ ...worker, ...vacationBalance(worker, vacationRows, deductionRows, balanceDate) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { vacations, deductions, balances, workers, balanceDate };
}
