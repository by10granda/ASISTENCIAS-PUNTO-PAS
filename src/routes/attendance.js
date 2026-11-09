import { Router } from 'express';
import { sendExcel, sendPdf } from '../exporters.js';
import {
  findCertificate,
  findWorker,
  listAttendance,
  listBranches,
  listWorkers,
  readCertificate,
  saveCertificate,
  upsertAttendance
} from '../store.js';
import { attendanceStatuses, clean, minutesBetween, requireText, today } from '../utils.js';

export const attendanceRouter = Router();

const allowedCertificateMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const maxCertificateBytes = 10 * 1024 * 1024;

const attendanceColumns = [
  { header: 'Fecha', key: 'record_date', width: 12 },
  { header: 'Trabajador', key: 'full_name', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'branch', width: 16 },
  { header: 'Estado', key: 'status', width: 20 },
  { header: 'Entrada', key: 'entry_time', width: 10 },
  { header: 'Hora establecida', key: 'scheduled_entry_time', width: 12 },
  { header: 'Hora real', key: 'actual_arrival_time', width: 10 },
  { header: 'Min. atraso', key: 'late_minutes', width: 10 },
  { header: 'Observacion', key: 'observation', width: 26 },
  { header: 'Certificado', key: 'certificate', width: 10 },
  { header: 'Usuario', key: 'registered_by', width: 14 },
  { header: 'Actualizado', key: 'updated_at', width: 16 }
];

attendanceRouter.get('/', async (req, res, next) => {
  try {
    const date = clean(req.query.date) || today();
    const branch = clean(req.query.branch);
    const { branches, workers, records } = await attendanceViewData(date, branch);
    const exportQuery = new URLSearchParams({ date, ...(branch ? { branch } : {}) }).toString();
    res.render('attendance/index', { title: 'Registro de asistencia', date, branch, branches, workers, records, statuses: attendanceStatuses, errors: [], exportQuery });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await attendanceExportData(req.query);
    sendExcel(res, `asistencia-${data.date}`, `Registro de asistencia ${data.date}`, attendanceColumns, data.rows);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await attendanceExportData(req.query);
    sendPdf(res, `asistencia-${data.date}`, `Registro de asistencia ${data.date}`, attendanceColumns, data.rows);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/', async (req, res, next) => {
  try {
    const record = normalizeAttendance(req.body);
    const certificate = normalizeCertificateUpload(req.body);
    const errors = await validateAttendance(record);
    if (certificate && record.status !== 'FALTA JUSTIFICADA') errors.push('El certificado solo puede adjuntarse a una falta justificada.');
    if (certificate && allowedCertificateMimes.has(certificate.mime_type) === false) errors.push('El certificado debe ser una imagen (JPG, PNG, WEBP) o un PDF.');
    if (certificate && certificate.size_bytes > maxCertificateBytes) errors.push('El certificado no puede pesar mas de 10 MB.');
    if (errors.length) return await renderAttendanceWithErrors(res, record.record_date, errors);

    if (certificate) record.has_support_doc = 1;
    await upsertAttendance(record);

    if (certificate) {
      await saveCertificate({
        worker_id: record.worker_id,
        record_date: record.record_date,
        file_name: certificate.file_name,
        mime_type: certificate.mime_type,
        data_base64: certificate.data_base64,
        uploaded_by: record.registered_by
      });
    }

    const branchQuery = clean(req.body.branch) ? `&branch=${encodeURIComponent(clean(req.body.branch))}` : '';
    res.redirect(`/asistencia?date=${record.record_date}${branchQuery}`);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get('/certificado', async (req, res, next) => {
  try {
    const workerId = clean(req.query.worker_id);
    const recordDate = clean(req.query.record_date);
    const meta = await findCertificate(workerId, recordDate);
    const content = await readCertificate(workerId, recordDate);
    res.setHeader('content-type', content.mime_type || 'application/octet-stream');
    res.setHeader('content-disposition', `inline; filename="certificado-${meta?.record_date || recordDate}"`);
    res.send(Buffer.from(content.data_base64, 'base64'));
  } catch (error) {
    if (error.message === 'CERTIFICADO_NO_ENCONTRADO') {
      return res.status(404).send('No se encontro el certificado almacenado para esta justificacion.');
    }
    next(error);
  }
});

async function renderAttendanceWithErrors(res, date, errors, branch = '') {
  const data = await attendanceViewData(date, branch);
  res.status(422).render('attendance/index', { title: 'Registro de asistencia', date, branch, branches: data.branches, ...data, statuses: attendanceStatuses, errors });
}

async function attendanceViewData(date, branch) {
  const [branches, allWorkers, allRecords] = await Promise.all([listBranches(), listWorkers(), listAttendance()]);
  const workers = allWorkers
    .filter((worker) => worker.status === 'Activo')
    .filter((worker) => !branch || worker.branch === branch)
    .sort(byName);
  const workerMap = new Map(allWorkers.map((worker) => [worker.id, worker]));
  const workerBranch = new Map(allWorkers.map((worker) => [worker.id, worker.branch]));
  const records = allRecords
    .filter((record) => record.record_date === date)
    .filter((record) => !branch || workerBranch.get(record.worker_id) === branch)
    .map((record) => {
      const worker = workerMap.get(record.worker_id);
      return {
        ...record,
        full_name: worker?.full_name || 'Trabajador no encontrado',
        cedula: worker?.cedula || '',
        branch: worker?.branch || '',
        certificate: Number(record.has_support_doc) ? 'Si' : 'No'
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const branchNames = [...new Set([...branches.map((branch) => branch.name), ...allWorkers.map((worker) => worker.branch)])].filter(Boolean).sort();
  return { branches: branchNames, workers, records };
}

async function attendanceExportData(query) {
  const date = clean(query.date) || today();
  const branch = clean(query.branch);
  const { records } = await attendanceViewData(date, branch);
  return { date, rows: records };
}

function normalizeAttendance(body) {
  const status = clean(body.status);
  const scheduled = clean(body.scheduled_entry_time);
  const actual = clean(body.actual_arrival_time);
  return {
    worker_id: clean(body.worker_id),
    record_date: clean(body.record_date),
    status,
    entry_time: clean(body.entry_time),
    scheduled_entry_time: scheduled,
    actual_arrival_time: actual,
    late_minutes: status === 'ATRASO' ? minutesBetween(scheduled, actual) : 0,
    observation: clean(body.observation),
    registered_by: clean(body.registered_by) || 'Administrador',
    justified_reason: status === 'FALTA JUSTIFICADA' ? clean(body.justified_reason) : '',
    has_support_doc: body.has_support_doc ? 1 : 0,
    permit_time_out: status === 'PERMISO' ? clean(body.permit_time_out) : '',
    permit_time_return: status === 'PERMISO' ? clean(body.permit_time_return) : '',
    permit_reason: status === 'PERMISO' ? clean(body.permit_reason) : '',
    permit_full_day: status === 'PERMISO' && body.permit_full_day ? 1 : 0
  };
}

function normalizeCertificateUpload(body) {
  const dataBase64 = String(body.certificate_data || '').replace(/^data:[^;]*;base64,/, '');
  if (!dataBase64) return null;
  return {
    file_name: clean(body.certificate_file_name) || `certificado-${clean(body.certificate_mime_type) === 'application/pdf' ? 'documento' : 'imagen'}`,
    mime_type: clean(body.certificate_mime_type),
    data_base64: dataBase64,
    size_bytes: Math.floor(dataBase64.length * 3 / 4)
  };
}

async function validateAttendance(record) {
  const errors = [];
  if (!record.worker_id || !(await findWorker(record.worker_id))) errors.push('Seleccione un trabajador valido.');
  if (!requireText(record.record_date)) errors.push('Seleccione la fecha.');
  if (!attendanceStatuses.includes(record.status)) errors.push('Seleccione un estado valido.');
  if (!requireText(record.registered_by)) errors.push('Ingrese el usuario que registra.');
  if (record.status === 'ASISTENCIA NORMAL' && !requireText(record.entry_time)) errors.push('Ingrese la hora de entrada.');
  if (record.status === 'FALTA JUSTIFICADA' && !requireText(record.justified_reason)) errors.push('Ingrese el motivo de la falta justificada.');
  if (record.status === 'ATRASO' && (!requireText(record.scheduled_entry_time) || !requireText(record.actual_arrival_time))) errors.push('Ingrese la hora establecida y la hora real de llegada.');
  if (record.status === 'PERMISO' && !requireText(record.permit_reason)) errors.push('Ingrese el motivo del permiso.');
  return errors;
}

function byName(a, b) {
  return a.full_name.localeCompare(b.full_name);
}
