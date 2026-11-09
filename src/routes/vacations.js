import { Router } from 'express';
import { sendExcel, sendPdf } from '../exporters.js';
import { createVacation, findWorker, listVacations, listWorkers } from '../store.js';
import { clean, daysInclusive, isValidDate, requireText, today } from '../utils.js';
import { vacationBalance } from '../vacationPolicy.js';

export const vacationsRouter = Router();

const vacationBalanceColumns = [
  { header: 'Trabajador', key: 'full_name', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'branch', width: 16 },
  { header: 'Ingreso', key: 'hire_date', width: 12 },
  { header: 'Anos cumplidos', key: 'completed_years', width: 10 },
  { header: 'Generados', key: 'earned_days', width: 10 },
  { header: 'Usados/programados', key: 'used_days', width: 12 },
  { header: 'Disponibles', key: 'available_days', width: 10 }
];

const vacationHistoryColumns = [
  { header: 'Trabajador', key: 'full_name', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'branch', width: 16 },
  { header: 'Inicio', key: 'start_date', width: 12 },
  { header: 'Fin', key: 'end_date', width: 12 },
  { header: 'Dias', key: 'total_days', width: 8 },
  { header: 'Estado', key: 'status', width: 12 },
  { header: 'Observacion', key: 'observation', width: 30 }
];

vacationsRouter.get('/', async (req, res, next) => {
  try {
    const branch = clean(req.query.branch);
    const from = clean(req.query.from);
    const to = clean(req.query.to);
    const data = await vacationViewData(branch, from, to);
    const exportQuery = new URLSearchParams(Object.entries({ branch, from, to }).filter(([, value]) => value)).toString();
    res.render('vacations/index', { title: 'Vacaciones', branch, from, to, exportQuery, ...data, errors: [] });
  } catch (error) {
    next(error);
  }
});

vacationsRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await vacationExportData(req.query);
    if (data.table === 'historial') {
      sendExcel(res, 'vacaciones-historial', 'Historial de vacaciones', vacationHistoryColumns, data.rows);
    } else {
      sendExcel(res, 'vacaciones-saldo', 'Saldo de vacaciones', vacationBalanceColumns, data.rows);
    }
  } catch (error) {
    next(error);
  }
});

vacationsRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await vacationExportData(req.query);
    if (data.table === 'historial') {
      sendPdf(res, 'vacaciones-historial', 'Historial de vacaciones', vacationHistoryColumns, data.rows);
    } else {
      sendPdf(res, 'vacaciones-saldo', 'Saldo de vacaciones', vacationBalanceColumns, data.rows);
    }
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
      return res.status(422).render('vacations/index', { title: 'Vacaciones', branch, from: '', to: '', exportQuery: branch ? `branch=${encodeURIComponent(branch)}` : '', ...data, errors });
    }

    await createVacation(vacation);
    res.redirect('/vacaciones');
  } catch (error) {
    next(error);
  }
});

async function vacationViewData(branchFilter = '', from = '', to = '') {
  const [allWorkers, vacationRows] = await Promise.all([listWorkers(), listVacations()]);
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const branches = [...new Set(allWorkers.map((worker) => worker.branch).filter(Boolean))].sort();
  const matchBranch = (workerId) => {
    const worker = workerMap.get(workerId);
    return !branchFilter || (worker && worker.branch === branchFilter);
  };
  const inRange = (vacation) => (!from || vacation.end_date >= from) && (!to || vacation.start_date <= to);
  const workers = allWorkers
    .filter((worker) => worker.status === 'Activo')
    .filter((worker) => !branchFilter || worker.branch === branchFilter)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const vacations = vacationRows
    .filter((vacation) => matchBranch(vacation.worker_id))
    .filter(inRange)
    .map((vacation) => {
      const worker = workerMap.get(vacation.worker_id);
      return {
        ...vacation,
        full_name: worker?.full_name || 'Trabajador no encontrado',
        cedula: worker?.cedula || '',
        branch: worker?.branch || ''
      };
    })
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const balanceDate = to || today();
  const balances = allWorkers
    .filter((worker) => !branchFilter || worker.branch === branchFilter)
    .map((worker) => ({ ...worker, ...vacationBalance(worker, vacationRows, [], balanceDate) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { branches, vacations, balances, workers, balanceDate };
}

async function vacationExportData(query) {
  const branch = clean(query.branch);
  const from = clean(query.from);
  const to = clean(query.to);
  const table = clean(query.table) === 'historial' ? 'historial' : 'saldo';
  const data = await vacationViewData(branch, from, to);
  return { table, rows: table === 'historial' ? data.vacations : data.balances };
}
