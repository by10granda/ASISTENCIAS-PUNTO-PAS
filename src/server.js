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
import { sendExcel, sendPdf } from './exporters.js';
import { initStore, listAttendance, listVacations, listWorkers, listVacationDeductions } from './store.js';
import { attendanceStatuses, clean, currentMonth, monthRange, today } from './utils.js';
import { vacationBalance } from './vacationPolicy.js';

const app = express();
const port = process.env.PORT || 3000;
let initPromise;

app.set('view engine', 'ejs');
app.set('views', path.resolve('src/views'));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));
app.use(express.json({ limit: '40mb' }));

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
    const data = await buildDashboardData(req.query);
    res.render('dashboard', { title: 'Panel principal', ...data });
  } catch (error) {
    next(error);
  }
});

app.get('/panel/excel', async (req, res, next) => {
  try {
    const data = await buildDashboardData(req.query);
    const exported = dashboardExport(clean(req.query.table), data);
    sendExcel(res, exported.filename, exported.title, exported.columns, exported.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/panel/pdf', async (req, res, next) => {
  try {
    const data = await buildDashboardData(req.query);
    const exported = dashboardExport(clean(req.query.table), data);
    sendPdf(res, exported.filename, exported.title, exported.columns, exported.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/panel/detalle/excel', async (req, res, next) => {
  try {
    const data = await buildDashboardData(req.query);
    const detail = buildDetailForKpi(clean(req.query.kpi), data);
    sendExcel(res, 'panel-detalle', detail.title, detailColumns, detail.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/panel/detalle/pdf', async (req, res, next) => {
  try {
    const data = await buildDashboardData(req.query);
    const detail = buildDetailForKpi(clean(req.query.kpi), data);
    sendPdf(res, 'panel-detalle', detail.title, detailColumns, detail.rows);
  } catch (error) {
    next(error);
  }
});

async function buildDashboardData(query) {
  const date = today();
  const month = currentMonth();
  const defaultRange = monthRange(month);
  const from = clean(query.from) || defaultRange.start;
  const to = clean(query.to) || defaultRange.end;
  const branch = clean(query.branch);
  const [allWorkers, allAttendance, allVacations, allDeductions] = await Promise.all([listWorkers(), listAttendance(), listVacations(), listVacationDeductions()]);
  const branches = [...new Set(allWorkers.map((worker) => worker.branch).filter(Boolean))].sort();
  const branchWorkerIds = branch ? new Set(allWorkers.filter((worker) => worker.branch === branch).map((worker) => String(worker.id))) : null;
  const belongsToBranch = (record) => !branchWorkerIds || branchWorkerIds.has(String(record.worker_id));
  const workers = branch ? allWorkers.filter((worker) => worker.branch === branch) : allWorkers;
  const attendance = allAttendance.filter(belongsToBranch);
  const vacations = allVacations.filter(belongsToBranch);
  const deductions = allDeductions.filter(belongsToBranch);
  const todayRecords = attendance.filter((record) => record.record_date === date);
  const monthRecords = attendance.filter((record) => record.record_date >= from && record.record_date <= to);

  /* ---- Filas de detalle para el panel interactivo ---- */
  const detailWorkerMap = new Map(allWorkers.map((worker) => [String(worker.id), worker]));
  const toDetailRows = (records) => records.map((record) => {
    const worker = detailWorkerMap.get(String(record.worker_id));
    const hasSupport = Number(record.has_support_doc) ? 1 : 0;
    return {
      fecha: record.record_date,
      trabajador: worker?.full_name || 'Trabajador no encontrado',
      cedula: worker?.cedula || '',
      sucursal: worker?.branch || '',
      estado: record.status,
      atraso: Number(record.late_minutes) || 0,
      observacion: record.observation || record.justified_reason || record.permit_reason || '',
      worker_id: record.worker_id,
      has_support_doc: hasSupport,
      certificado: hasSupport ? 'Si' : 'No'
    };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.trabajador.localeCompare(b.trabajador));
  const todayRows = toDetailRows(todayRecords);
  const rangeRows = toDetailRows(monthRecords);
  const workerDetailRow = (worker, estado) => ({
    fecha: '',
    trabajador: worker.full_name,
    cedula: worker.cedula,
    sucursal: worker.branch,
    estado,
    atraso: 0,
    observacion: worker.position || '',
    worker_id: worker.id,
    has_support_doc: 0,
    certificado: 'No'
  });
  const activeRows = workers.filter((worker) => worker.status === 'Activo').map((worker) => workerDetailRow(worker, 'Activo'));
  const pendingRows = workers
    .filter((worker) => worker.status === 'Activo' && !todayRecords.some((record) => record.worker_id === worker.id))
    .map((worker) => workerDetailRow(worker, 'Sin registro hoy'));
  const vacationRangeRows = vacations
    .filter((vacation) => date >= vacation.start_date && date <= vacation.end_date && ['Programadas', 'En curso'].includes(vacation.status))
    .map((vacation) => {
      const worker = detailWorkerMap.get(String(vacation.worker_id));
      return {
        fecha: `${vacation.start_date} a ${vacation.end_date}`,
        trabajador: worker?.full_name || 'Trabajador no encontrado',
        cedula: worker?.cedula || '',
        sucursal: worker?.branch || '',
        estado: 'VACACIONES',
        atraso: 0,
        observacion: vacation.observation || vacation.status,
        worker_id: vacation.worker_id,
        has_support_doc: 0,
        certificado: 'No'
      };
    });
  const vacationDetailRows = (() => {
    const seen = new Set();
    const rows = [];
    todayRows.filter((row) => row.estado === 'VACACIONES').forEach((row) => {
      const key = row.cedula || row.trabajador;
      seen.add(key);
      rows.push(row);
    });
    vacationRangeRows.forEach((row) => {
      const key = row.cedula || row.trabajador;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    });
    return rows;
  })();
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
    const attendanceStatuses = ['ASISTENCIA NORMAL', 'FALTA JUSTIFICADA', 'FALTA INJUSTIFICADA', 'ATRASO', 'VACACIONES', 'PERMISO', 'DIA LIBRE'];

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
      const branchName = w ? w.branch : 'Sin sucursal';
      byBranch[branchName] = (byBranch[branchName] || 0) + 1;
    });
    chartBranch = {
      labels: Object.keys(byBranch),
      data: Object.values(byBranch)
    };
  } catch (e) {
    console.error('[dashboard] Error calculando graficas:', e.message);
  }

  const exportQuery = new URLSearchParams(Object.entries({ branch, from, to }).filter(([, value]) => value)).toString();
  return { counts, monthly, month, start: from, end: to, vacationRanges, summary, lowVacation, balanceDate, branch, branches, exportQuery, chartMonths, topUnjustified, chartBranch, todayRows, rangeRows, activeRows, pendingRows, vacationDetailRows };
}

const dashboardBalanceColumns = [
  { header: 'Trabajador', key: 'full_name', width: 28 },
  { header: 'Cedula', key: 'cedula', width: 16 },
  { header: 'Sucursal', key: 'branch', width: 18 },
  { header: 'Generados', key: 'earned_days', width: 12 },
  { header: 'Usados', key: 'used_days', width: 12 },
  { header: 'Disponibles', key: 'available_days', width: 12 }
];

const dashboardSummaryColumns = [
  { header: 'Tipo de novedad', key: 'status', width: 40 },
  { header: 'Total', key: 'total', width: 16 },
  { header: 'Minutos atraso', key: 'minutes', width: 18 }
];

function dashboardExport(table, data) {
  if (table === 'saldo') {
    return {
      filename: 'panel-saldo-vacaciones',
      title: 'Saldo de vacaciones bajo o negativo',
      columns: dashboardBalanceColumns,
      rows: data.lowVacation
    };
  }
  return {
    filename: `panel-resumen-${data.start}-${data.end}`,
    title: `Resumen del ${data.start} al ${data.end}`,
    columns: dashboardSummaryColumns,
    rows: data.monthly
  };
}

const detailColumns = [
  { header: 'Fecha', key: 'fecha', width: 14 },
  { header: 'Trabajador', key: 'trabajador', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'sucursal', width: 16 },
  { header: 'Novedad', key: 'estado', width: 20 },
  { header: 'Atraso (min)', key: 'atraso', width: 12 },
  { header: 'Certificado', key: 'certificado', width: 12 },
  { header: 'Observacion', key: 'observacion', width: 30 }
];

const DETAIL_STATUS_BY_KPI = {
  present: 'ASISTENCIA NORMAL',
  justified_today: 'FALTA JUSTIFICADA',
  justified_range: 'FALTA JUSTIFICADA',
  unjustified_today: 'FALTA INJUSTIFICADA',
  unjustified_range: 'FALTA INJUSTIFICADA',
  late_today: 'ATRASO',
  late_minutes: 'ATRASO',
  vacation_range: 'VACACIONES',
  permit_today: 'PERMISO',
  permit_range: 'PERMISO'
};

const DETAIL_RANGE_KPIS = new Set(['worked', 'late_minutes', 'justified_range', 'unjustified_range', 'vacation_range', 'permit_range']);

const DETAIL_KPI_LABELS = {
  active: 'Trabajadores activos',
  present: 'Presentes hoy',
  pending: 'Sin registro hoy',
  justified_today: 'Faltas justificadas (hoy)',
  unjustified_today: 'Faltas injustificadas (hoy)',
  late_today: 'Atrasos hoy',
  vacation_today: 'De vacaciones',
  permit_today: 'Con permiso',
  worked: 'Dias laborados (rango)',
  late_minutes: 'Min. atraso (rango)',
  justified_range: 'Faltas justificadas (rango)',
  unjustified_range: 'Faltas injustificadas (rango)',
  vacation_range: 'Vacaciones (rango)',
  permit_range: 'Permisos (rango)'
};

function buildDetailForKpi(kpi, data) {
  const label = DETAIL_KPI_LABELS[kpi] || 'Registros del rango';
  let rows;
  if (kpi === 'active') {
    rows = data.activeRows;
  } else if (kpi === 'pending') {
    rows = data.pendingRows;
  } else if (kpi === 'vacation_today') {
    rows = data.vacationDetailRows;
  } else {
    const base = DETAIL_RANGE_KPIS.has(kpi) ? data.rangeRows : data.todayRows;
    if (kpi === 'worked') {
      rows = base.filter((row) => row.estado === 'ASISTENCIA NORMAL' || row.estado === 'ATRASO');
    } else if (DETAIL_STATUS_BY_KPI[kpi]) {
      rows = base.filter((row) => row.estado === DETAIL_STATUS_BY_KPI[kpi]);
    } else {
      rows = data.rangeRows;
    }
  }
  return { title: `Panel - ${label}`, label, rows };
}

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
