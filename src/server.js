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
import { initStore, listAttendance, listVacations, listWorkers } from './sheetsStore.js';
import { currentMonth, monthRange, today } from './utils.js';

const app = express();
const port = process.env.PORT || 3000;
let initPromise;

app.set('view engine', 'ejs');
app.set('views', path.resolve('src/views'));
app.use(express.urlencoded({ extended: true }));
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
    const [workers, attendance, vacations] = await Promise.all([listWorkers(), listAttendance(), listVacations()]);
    const todayRecords = attendance.filter((record) => record.record_date === date);
    const monthRecords = attendance.filter((record) => record.record_date >= start && record.record_date <= end);
    const counts = {
      active_workers: workers.filter((worker) => worker.status === 'Activo').length,
      present_today: count(todayRecords, 'ASISTENCIA NORMAL'),
      justified_today: count(todayRecords, 'FALTA JUSTIFICADA'),
      unjustified_today: count(todayRecords, 'FALTA INJUSTIFICADA'),
      late_today: count(todayRecords, 'ATRASO'),
      vacation_today: count(todayRecords, 'VACACIONES'),
      permit_today: count(todayRecords, 'PERMISO')
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
    res.render('dashboard', { title: 'Panel principal', counts, monthly, month, vacationRanges });
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
