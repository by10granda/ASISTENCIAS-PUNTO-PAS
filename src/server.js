import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attendanceRouter } from './routes/attendance.js';
import { historyRouter } from './routes/history.js';
import { incidentsRouter } from './routes/incidents.js';
import { reportsRouter } from './routes/reports.js';
import { vacationsRouter } from './routes/vacations.js';
import { workersRouter } from './routes/workers.js';
import { initStore, listAttendance, listVacations, listWorkers, listVacationDeductions } from './store.js';
import { attendanceStatuses, clean, currentMonth, monthRange, today } from './utils.js';
import { vacationBalance } from './vacationPolicy.js';

const app = express();
const port = process.env.PORT || 3000;
let initPromise;

app.set('view engine', 'ejs');
app.set('views', path.resolve('src/views'));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));

const appUser = process.env.APP_USERNAME;
const appPassword = process.env.APP_PASSWORD;
if (appUser && appPassword) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (user === appUser && password === appPassword) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Asistencias", charset="UTF-8"');
    res.status(401).send('Autenticacion requerida.');
  });
}

app.use(express.static(path.resolve('public')));

app.use(async (req, res, next) => {
  res.locals.path = req.path;
  try {
    initPromise ||= initStore();
    await initPromise;
    next();
  } catch (error) {
    next(error);
  }
});

app.get('/', async (req, res, next) => {
  try {
    const date = today();
    const month = currentMonth();
    const { start, end } = monthRange(month);
    const branch = clean(req.query.branch);
    const [allWorkers, allAttendance, allVacations, allDeductions] = await Promise.all([listWorkers(), listAttendance(), listVacations(), listVacationDeductions()]);
    const branches = [...new Set(allWorkers.map((worker) => worker.branch).filter(Boolean))].sort();
    const branchWorkerIds = branch ? new Set(allWorkers.filter((worker) => worker.branch === branch).map((worker) => String(worker.id))) : null;
    const belongsToBranch = (record) => !branchWorkerIds || branchWorkerIds.has(String(record.worker_id));
    const workers = branch ? allWorkers.filter((worker) => worker.branch === branch) : allWorkers;
    const attendance = allAttendance.filter(belongsToBranch);
    const vacations = allVacations.filter(belongsToBranch);
    const deductions = allDeductions.filter(belongsToBranch);
    const todayRecords = attendance.filter((record) => record.record_date === date);
    const monthRecords = attendance.filter((record) => record.record_date >= start && record.record_date <= end);
    const counts = {
      active_workers: workers.filter((worker) => worker.status === 'Activo').length,
      present_today: count(todayRecords, 'ASISTENCIA NORMAL'),
      justified_today: count(todayRecords, 'FALTA JUSTIFICADA'),
      unjustified_today: count(todayRecords, 'FALTA INJUSTIFICADA'),
      late_today: count(todayRecords, 'ATRASO'),
      late_minutes_today: todayRecords.filter((r) => r.status === 'ATRASO').reduce((s, r) => s + (Number(r.late_minutes) || 0), 0),
      vacation_today: count(todayRecords, 'VACACIONES'),
      permit_today: count(todayRecords, 'PERMISO'),
      pending_today: workers.filter((w) => w.status === 'Activo' && !todayRecords.some((r) => r.worker_id === w.id)).length
    };
    const grouped = new Map();
    monthRecords.forEach((record) => {
      const current = grouped.get(record.status) || { status: record.status, total: 0, minutes: 0 };
      current.total += 1;
      current.minutes += record.status === 'ATRASO' ? Number(record.late_minutes) || 0 : 0;
      grouped.set(record.status, current);
    });
    const monthly = [...grouped.values()].sort((a, b) => b.total - a.total);
    const vacationRanges = {
      total: vacations.filter((vacation) => date >= vacation.start_date && date <= vacation.end_date && ['Programadas', 'En curso'].includes(vacation.status)).length
    };
    const summary = {
      worked_days_month: monthRecords.filter((r) => r.status === 'ASISTENCIA NORMAL' || r.status === 'ATRASO').length,
      late_minutes_month: monthRecords.filter((r) => r.status === 'ATRASO').reduce((s, r) => s + (Number(r.late_minutes) || 0), 0),
      justified_month: count(monthRecords, 'FALTA JUSTIFICADA'),
      unjustified_month: count(monthRecords, 'FALTA INJUSTIFICADA'),
      vacation_month: count(monthRecords, 'VACACIONES'),
      permit_month: count(monthRecords, 'PERMISO')
    };
    const balanceDate = today();
    const lowVacation = workers
      .filter((w) => w.status === 'Activo')
      .map((w) => ({ ...w, ...vacationBalance(w, vacations, deductions, balanceDate) }))
      .filter((b) => b.available_days <= 0)
      .sort((a, b) => a.available_days - b.available_days);

    /* ---- Datos para gráficas mensuales ---- */
    let chartMonths = { labels: [], datasets: [] };
    let topUnjustified = [];
    let chartBranch = { labels: [], data: [] };
    try {
      const workerMap = new Map(workers.map((w) => [String(w.id), w]));
      const attendanceStatuses = ['ASISTENCIA NORMAL', 'FALTA JUSTIFICADA', 'FALTA INJUSTIFICADA', 'ATRASO', 'VACACIONES', 'PERMISO'];

      // Últimos 6 meses (incluyendo el actual)
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        months.push(`${y}-${m}`);
      }
      const monthLabels = months.map((m) => {
        const [y, mm] = m.split('-');
        return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
      });
      const seriesByMonth = {};
      attendanceStatuses.forEach((s) => { seriesByMonth[s] = new Array(6).fill(0); });
      attendance.forEach((record) => {
        const ym = record.record_date.slice(0, 7);
        const idx = months.indexOf(ym);
        if (idx !== -1 && seriesByMonth[record.status] !== undefined) {
          seriesByMonth[record.status][idx] += 1;
        }
      });
      chartMonths = {
        labels: monthLabels,
        datasets: attendanceStatuses.map((status) => ({
          label: status,
          data: seriesByMonth[status],
          fill: false
        }))
      };

      // Top 5 trabajadores con más faltas injustificadas este mes
      const unjustByWorker = {};
      monthRecords.filter((r) => r.status === 'FALTA INJUSTIFICADA').forEach((r) => {
        unjustByWorker[r.worker_id] = (unjustByWorker[r.worker_id] || 0) + 1;
      });
      topUnjustified = Object.entries(unjustByWorker)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([wid, total]) => {
          const w = workerMap.get(String(wid));
          return { name: w ? w.full_name : `Trabajador ${wid}`, cedula: w ? w.cedula : '-', total };
        });

      // Distribución por sucursal este mes
      const byBranch = {};
      monthRecords.forEach((r) => {
        const w = workerMap.get(String(r.worker_id));
        const branch = w ? w.branch : 'Sin sucursal';
        byBranch[branch] = (byBranch[branch] || 0) + 1;
      });
      chartBranch = {
        labels: Object.keys(byBranch),
        data: Object.values(byBranch)
      };
    } catch (e) {
      console.error('[dashboard] Error calculando graficas:', e.message);
    }

    res.render('dashboard', {
      title: 'Panel principal',
      counts,
      monthly,
      month,
      vacationRanges,
      summary,
      lowVacation,
      balanceDate,
      branch,
      branches,
      chartMonths,
      topUnjustified,
      chartBranch
    });
  } catch (error) {
    next(error);
  }
});

app.use('/trabajadores', workersRouter);
app.use('/asistencia', attendanceRouter);
app.use('/vacaciones', vacationsRouter);
app.use('/novedades', incidentsRouter);
app.use('/historial', historyRouter);
app.use('/reportes', reportsRouter);

app.use((req, res) => res.status(404).render('error', { title: 'No encontrado', message: 'La pagina solicitada no existe.' }));
app.use((error, req, res, next) => {
  console.error(error);
  const message = error.message?.startsWith('Faltan variables')
    ? error.message
    : 'Ocurrio un error inesperado.';
  res.status(500).render('error', { title: 'Error', message });
});

function count(records, status) {
  return records.filter((record) => record.status === status).length;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(port, () => {
    console.log(`Sistema de asistencia disponible en http://localhost:${port}`);
  });
}

export default app;
