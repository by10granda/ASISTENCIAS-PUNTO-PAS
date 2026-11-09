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
import { attendanceStatuses, clean, isValidDate, minutesBetween, requireText, today } from '../utils.js';

export const attendanceRouter = Router();

const allowedCertificateMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const maxCertificateBytes = 10 * 1024 * 1024;
const maxBulkCertificateBytes = 30 * 1024 * 1024;

const attendanceColumns = [
  { header: 'Fecha', key: 'record_date', width: 12 },
  { header: 'Trabajador', key: 'full_name', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'branch', width: 16 },
  { header: 'Estado', key: 'status', width: 20 },
  { header: 'Entrada', key: 'entry_time', width: 10 },
  { header: 'Regreso almuerzo', key: 'lunch_in', width: 12 },
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
    const saved = Number(clean(req.query.saved)) || 0;
    const data = await attendanceViewData(date, branch);
    const exportQuery = new URLSearchParams({ date, ...(branch ? { branch } : {}) }).toString();
    res.render('attendance/index', { title: 'Registro de asistencia', date, branch, saved, ...data, statuses: attendanceStatuses, errors: [], exportQuery });
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

attendanceRouter.post('/rapido', async (req, res, next) => {
  try {
    const recordDate = clean(req.body.record_date);
    const branch = clean(req.body.branch);
    const registeredBy = clean(req.body.registered_by) || 'Administrador';
    const scheduled = clean(req.body.scheduled_entry_time);
    const ids = [].concat(req.body.worker_id || []).map((value) => clean(value));
    const statuses = [].concat(req.body.status || []).map((value) => clean(value));
    const entries = [].concat(req.body.entry_time || []).map((value) => clean(value));
    const rowSchedules = [].concat(req.body.row_scheduled || []).map((value) => clean(value));
    const observations = [].concat(req.body.observation || []).map((value) => clean(value));
    const lunchLimit = clean(req.body.lunch_limit);
    const lunchOuts = [].concat(req.body.lunch_out || []).map((value) => clean(value));
    const lunchIns = [].concat(req.body.lunch_in || []).map((value) => clean(value));
    const errors = [];
    if (!requireText(recordDate) || !isValidDate(recordDate)) errors.push('Seleccione una fecha valida.');
    if (!branch) errors.push('Seleccione una sucursal.');

    const allWorkers = await listWorkers();
    const workerMap = new Map(allWorkers.map((worker) => [String(worker.id), worker]));
    const pending = [];
    let certificateBytes = 0;

    for (let index = 0; index < ids.length; index += 1) {
      const workerId = ids[index];
      const status = statuses[index] || '';
      if (!status) continue;
      const worker = workerMap.get(workerId);
      const rowLabel = worker ? worker.full_name : `fila ${index + 1}`;
      if (!worker || (branch && worker.branch !== branch)) {
        errors.push(`${rowLabel}: no pertenece a la sucursal seleccionada.`);
        continue;
      }
      if (!attendanceStatuses.includes(status)) {
        errors.push(`${rowLabel}: estado no valido.`);
        continue;
      }

      const entry = entries[index] || '';
      const rowScheduled = rowSchedules[index] || '';
      const scheduledForRow = rowScheduled || scheduled;
      const observation = observations[index] || '';
      let lateMinutes = 0;
      if (status === 'ASISTENCIA NORMAL' && !entry) errors.push(`${rowLabel}: ingrese la hora de entrada.`);
      if (status === 'ATRASO') {
        if (!scheduledForRow) errors.push('Ingrese la hora establecida para calcular los atrasos.');
        if (!entry) errors.push(`${rowLabel}: ingrese la hora real de llegada.`);
        if (scheduledForRow && entry) lateMinutes = minutesBetween(scheduledForRow, entry);
      }
      // Una sola hora de almuerzo (regreso real). Si se pasa del límite, ya son minutos de atraso.
      const lunchIn = lunchIns[index] || '';
      const lunchExcess = lunchLimit && lunchIn ? minutesBetween(lunchLimit, lunchIn) : 0;
      if (lunchExcess > 0) lateMinutes += lunchExcess;
      if (status === 'FALTA JUSTIFICADA' && !observation) errors.push(`${rowLabel}: ingrese el motivo de la falta justificada.`);
      if (status === 'PERMISO' && !observation) errors.push(`${rowLabel}: ingrese el motivo del permiso.`);

      const certificate = normalizeBulkCertificate(req.body, workerId);
      if (certificate && status !== 'FALTA JUSTIFICADA') errors.push(`${rowLabel}: el certificado solo aplica a faltas justificadas.`);
      if (certificate && !allowedCertificateMimes.has(certificate.mime_type)) errors.push(`${rowLabel}: el certificado debe ser una imagen o un PDF.`);
      if (certificate && certificate.size_bytes > maxCertificateBytes) errors.push(`${rowLabel}: el certificado supera los 10 MB.`);
      certificateBytes += certificate ? certificate.size_bytes : 0;

      pending.push({
        worker_id: workerId,
        record_date: recordDate,
        status,
        entry_time: status === 'ASISTENCIA NORMAL' ? entry : '',
        scheduled_entry_time: status === 'ATRASO' ? scheduledForRow : '',
        actual_arrival_time: status === 'ATRASO' ? entry : '',
        late_minutes: lateMinutes,
        observation,
        registered_by: registeredBy,
        justified_reason: status === 'FALTA JUSTIFICADA' ? observation : '',
        has_support_doc: certificate ? 1 : 0,
        permit_time_out: '',
        permit_time_return: '',
        permit_reason: status === 'PERMISO' ? observation : '',
        permit_full_day: status === 'PERMISO' ? 1 : 0,
        lunch_out: lunchLimit || lunchOuts[index] || '',
        lunch_in: lunchIn || '',
        _certificate: certificate
      });
    }

    if (certificateBytes > maxBulkCertificateBytes) errors.push('Los certificados adjuntos superan el limite total de 30 MB por guardado.');
    if (!pending.length && !errors.length) errors.push('No hay filas con estado para guardar.');

    if (errors.length) {
      return await renderAttendanceWithErrors(res, recordDate || today(), errors, branch);
    }

    for (const record of pending) {
      const certificate = record._certificate;
      delete record._certificate;
      if (!certificate && record.status === 'FALTA JUSTIFICADA') {
        const existing = await findCertificate(record.worker_id, record.record_date);
        record.has_support_doc = existing ? 1 : 0;
      }
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
    }

    res.redirect(`/asistencia?date=${encodeURIComponent(recordDate)}&branch=${encodeURIComponent(branch)}&saved=${pending.length}`);
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
  const exportQuery = new URLSearchParams({ date, ...(branch ? { branch } : {}) }).toString();
  res.status(422).render('attendance/index', { title: 'Registro de asistencia', date, branch, saved: 0, branches: data.branches, ...data, statuses: attendanceStatuses, errors, exportQuery });
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
  const recordByWorker = new Map(records.map((record) => [String(record.worker_id), record]));
  const workerRows = workers.map((worker) => ({ worker, record: recordByWorker.get(String(worker.id)) || null }));
  return { branches: branchNames, workers, records, workerRows };
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
    permit_full_day: status === 'PERMISO' && body.permit_full_day ? 1 : 0,
    lunch_out: clean(body.lunch_out),
    lunch_in: clean(body.lunch_in)
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

function normalizeBulkCertificate(body, workerId) {
  const dataBase64 = String(body[`cert_${workerId}_data`] || '').replace(/^data:[^;]*;base64,/, '');
  if (!dataBase64) return null;
  const mime = clean(body[`cert_${workerId}_mime_type`]);
  return {
    file_name: clean(body[`cert_${workerId}_file_name`]) || `certificado-${mime === 'application/pdf' ? 'documento' : 'imagen'}`,
    mime_type: mime,
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
