import { Router } from 'express';
import { parseBiometricReport, suggestMatches } from '../biometricReport.js';
import { sendExcel, sendPdf } from '../exporters.js';
import {
  deleteAttendanceRecord,
  findCertificate,
  findWorker,
  listAttendance,
  listBranches,
  listWorkers,
  readCertificate,
  saveCertificate,
  updateAttendanceRecord,
  upsertAttendance,
  upsertAttendanceBatch
} from '../store.js';
import { attendanceStatuses, clean, isValidDate, minutesBetween, requireText, today } from '../utils.js';

export const attendanceRouter = Router();

const allowedCertificateMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const maxCertificateBytes = 10 * 1024 * 1024;
const maxBulkCertificateBytes = 30 * 1024 * 1024;
const biometricBranch = 'VARIEDADES PAS';
const maxBiometricBytes = 10 * 1024 * 1024;
const biometricStatuses = new Set(['ASISTENCIA NORMAL', 'ATRASO', 'DIA LIBRE']);

const attendanceColumns = [
  { header: 'Fecha', key: 'record_date', width: 12 },
  { header: 'Trabajador', key: 'full_name', width: 26 },
  { header: 'Cedula', key: 'cedula', width: 14 },
  { header: 'Sucursal', key: 'branch', width: 16 },
  { header: 'Estado', key: 'status', width: 20 },
  { header: 'Entrada', key: 'entry_time', width: 10 },
  { header: 'Salida almuerzo', key: 'lunch_out', width: 12 },
  { header: 'Regreso almuerzo', key: 'lunch_in', width: 12 },
  { header: 'Hora salida', key: 'exit_time', width: 10 },
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
    const imported = Number(clean(req.query.imported)) || 0;
    const data = await attendanceViewData(date, branch);
    const exportQuery = new URLSearchParams({ date, ...(branch ? { branch } : {}) }).toString();
    const title = branch ? `Asistencia · ${branch}` : 'Registro de asistencia';
    res.render('attendance/index', {
      title,
      date,
      branch,
      saved,
      imported,
      canImport: branch === biometricBranch,
      biometricBranch,
      ...data,
      statuses: attendanceStatuses,
      errors: [],
      exportQuery
    });
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
    const expectedEntry = clean(req.body.expected_entry_time) || '07:00';
    const ids = [].concat(req.body.worker_id || []).map((value) => clean(value));
    const statuses = [].concat(req.body.status || []).map((value) => clean(value));
    const entries = [].concat(req.body.entry_time || []).map((value) => clean(value));
    const rowSchedules = [].concat(req.body.row_scheduled || []).map((value) => clean(value));
    const lunchOuts = [].concat(req.body.lunch_out || []).map((value) => clean(value));
    const lunchIns = [].concat(req.body.lunch_in || []).map((value) => clean(value));
    const exits = [].concat(req.body.exit_time || []).map((value) => clean(value));
    const observations = [].concat(req.body.observation || []).map((value) => clean(value));
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
      const lunchOut = lunchOuts[index] || '';
      const lunchIn = lunchIns[index] || '';
      const exit = exits[index] || '';
      const rowScheduled = rowSchedules[index] || '';
      const scheduledForRow = rowScheduled || scheduled;
      const observation = observations[index] || '';
      let lateMinutes = 0;
      if (status === 'ASISTENCIA NORMAL' && !entry) errors.push(`${rowLabel}: ingrese la hora de entrada.`);
      if (status === 'ATRASO') {
        if (!scheduledForRow) errors.push('Ingrese la hora establecida para calcular los atrasos.');
        if (!entry) errors.push(`${rowLabel}: ingrese la hora real de llegada.`);
      }
      lateMinutes = calculateLateMinutes({ status, entry, scheduled: scheduledForRow, expectedEntry, lunchOut, lunchIn, exit });

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
        lunch_out: lunchOuts[index] || '',
        lunch_in: lunchIns[index] || '',
        exit_time: exits[index] || '',
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

attendanceRouter.post('/biometrico/analizar', async (req, res, next) => {
  try {
    const branch = clean(req.body.branch);
    if (branch !== biometricBranch) {
      return res.status(403).json({ ok: false, error: `La importacion solo esta disponible para la sucursal ${biometricBranch}.` });
    }

    const dataBase64 = String(req.body.file_data || '').replace(/^data:[^;]*;base64,/, '');
    if (!dataBase64) {
      return res.status(422).json({ ok: false, error: 'Seleccione el archivo Excel del biometrico.' });
    }
    const sizeBytes = Math.floor(dataBase64.length * 3 / 4);
    if (sizeBytes > maxBiometricBytes) {
      return res.status(422).json({ ok: false, error: 'El archivo supera los 10 MB permitidos.' });
    }

    let report;
    try {
      report = await parseBiometricReport(Buffer.from(dataBase64, 'base64'));
    } catch (error) {
      return res.status(422).json({ ok: false, error: biometricErrorMessage(error.message) });
    }

    // Se incluyen tambien los trabajadores inactivos: el reporte puede traer
    // dias de alguien que ya salio de la empresa.
    const allWorkers = await listWorkers();
    const candidates = allWorkers
      .filter((worker) => worker.branch === branch)
      .sort(byName)
      .map((worker) => ({
        id: String(worker.id),
        full_name: worker.full_name,
        cedula: worker.cedula,
        status: worker.status
      }));
    const matches = suggestMatches(report.workers.map((worker) => worker.excel_name), candidates);

    res.json({
      ok: true,
      branch,
      file_name: clean(req.body.file_name),
      sheet: report.sheet,
      range: report.range,
      days: report.days,
      candidates,
      workers: report.workers.map((worker, index) => ({
        excel_id: worker.excel_id,
        excel_name: worker.excel_name,
        dept: worker.dept,
        match: matches[index].match,
        worker_id: matches[index].worker_id,
        alternatives: matches[index].alternatives,
        score: matches[index].score,
        days: worker.days
      }))
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/biometrico/guardar', async (req, res, next) => {
  try {
    const branch = clean(req.body.branch);
    if (branch !== biometricBranch) {
      return res.status(403).json({ ok: false, error: `La importacion solo esta disponible para la sucursal ${biometricBranch}.` });
    }
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(422).json({ ok: false, error: 'No hay dias para guardar.' });
    }
    if (rows.length > 1000) {
      return res.status(422).json({ ok: false, error: 'El reporte tiene demasiados dias para guardar de una vez.' });
    }

    const allWorkers = await listWorkers();
    const workerMap = new Map(allWorkers.map((worker) => [String(worker.id), worker]));
    const registeredBy = clean(req.body.registered_by) || 'Administrador';
    const pending = [];
    const errors = [];
    const seen = new Set();

    rows.forEach((row, index) => {
      const worker = workerMap.get(String(row?.worker_id ?? ''));
      const recordDate = clean(row?.record_date);
      const label = worker ? worker.full_name : `fila ${index + 1}`;
      if (!worker || worker.branch !== branch) {
        errors.push(`${label}: seleccione un trabajador de ${branch}.`);
        return;
      }
      if (!isValidDate(recordDate)) {
        errors.push(`${label}: la fecha no es valida.`);
        return;
      }

      const status = biometricStatuses.has(clean(row?.status)) ? clean(row.status) : 'ASISTENCIA NORMAL';
      const entry = sanitizeTime(row?.entry_time);
      const lunchOut = sanitizeTime(row?.lunch_out);
      const lunchIn = sanitizeTime(row?.lunch_in);
      const exit = sanitizeTime(row?.exit_time);
      const invalidTime = [entry, lunchOut, lunchIn, exit].find((time) => !time.valid);
      if (invalidTime) {
        errors.push(`${label} ${recordDate}: hay una hora con formato invalido.`);
        return;
      }
      if (status !== 'DIA LIBRE' && !entry.value) {
        errors.push(`${label} ${recordDate}: ingrese la hora de entrada.`);
        return;
      }

      const key = `${worker.id}|${recordDate}`;
      if (seen.has(key)) {
        errors.push(`${label} ${recordDate}: el dia esta repetido.`);
        return;
      }
      seen.add(key);

      const isWorked = status === 'ASISTENCIA NORMAL' || status === 'ATRASO';
      const lunchOutValue = isWorked ? lunchOut.value : '';
      const lunchInValue = isWorked ? lunchIn.value : '';
      const exitValue = isWorked ? exit.value : '';
      pending.push({
        worker_id: String(worker.id),
        record_date: recordDate,
        status,
        entry_time: status === 'ASISTENCIA NORMAL' ? entry.value : '',
        scheduled_entry_time: status === 'ATRASO' ? '07:00' : '',
        actual_arrival_time: status === 'ATRASO' ? entry.value : '',
        late_minutes: calculateLateMinutes({
          status,
          entry: entry.value,
          scheduled: '07:00',
          expectedEntry: '07:00',
          lunchOut: lunchOutValue,
          lunchIn: lunchInValue,
          exit: exitValue
        }),
        observation: clean(row?.observation),
        registered_by: registeredBy,
        justified_reason: '',
        has_support_doc: 0,
        permit_time_out: '',
        permit_time_return: '',
        permit_reason: '',
        permit_full_day: 0,
        lunch_out: lunchOutValue,
        lunch_in: lunchInValue,
        exit_time: exitValue
      });
    });

    if (errors.length) {
      return res.status(422).json({ ok: false, error: errors[0], errors: errors.slice(0, 20) });
    }
    if (!pending.length) {
      return res.status(422).json({ ok: false, error: 'No hay dias asignados a trabajadores para guardar.' });
    }

    if (typeof upsertAttendanceBatch === 'function') {
      await upsertAttendanceBatch(pending);
    } else {
      for (const record of pending) await upsertAttendance(record);
    }
    res.json({ ok: true, saved: pending.length });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/registro/editar', async (req, res, next) => {
  try {
    const records = await listAttendance();
    const existing = records.find((record) => String(record.id) === String(req.body.id));
    if (!existing) return res.status(404).json({ ok: false, error: 'El registro ya no existe.' });

    const recordDate = clean(req.body.record_date);
    const status = clean(req.body.status);
    const entry = clean(req.body.entry_time);
    const lunchOut = clean(req.body.lunch_out);
    const lunchIn = clean(req.body.lunch_in);
    const exit = clean(req.body.exit_time);
    const scheduled = clean(req.body.scheduled_entry_time);
    const actual = clean(req.body.actual_arrival_time);
    const errors = [];

    if (!isValidDate(recordDate)) errors.push('Seleccione una fecha valida.');
    if (!attendanceStatuses.includes(status)) errors.push('Seleccione un estado valido.');
    if (status === 'ASISTENCIA NORMAL' && !entry) errors.push('Ingrese la hora de entrada.');
    if (status === 'ATRASO' && (!scheduled || !actual)) errors.push('Ingrese la hora establecida y la hora real de llegada.');
    const certificate = req.body.certificate_data ? normalizeCertificateUpload(req.body) : null;
    if (certificate && status !== 'FALTA JUSTIFICADA') errors.push('El certificado solo aplica a faltas justificadas.');
    if (certificate && !allowedCertificateMimes.has(certificate.mime_type)) errors.push('El certificado debe ser una imagen o un PDF.');
    if (certificate && certificate.size_bytes > maxCertificateBytes) errors.push('El certificado supera los 10 MB.');
    if (errors.length) return res.status(422).json({ ok: false, errors });

    const record = {
      worker_id: existing.worker_id,
      record_date: recordDate,
      status,
      entry_time: entry,
      scheduled_entry_time: scheduled,
      actual_arrival_time: actual,
      late_minutes: calculateLateMinutes({ status, entry: status === 'ATRASO' ? actual : entry, scheduled, expectedEntry: '07:00', lunchOut, lunchIn, exit }),
      observation: clean(req.body.observation),
      registered_by: clean(req.body.registered_by) || 'Administrador',
      justified_reason: clean(req.body.justified_reason),
      has_support_doc: certificate ? 1 : (Number(existing.has_support_doc) ? 1 : 0),
      permit_time_out: clean(req.body.permit_time_out),
      permit_time_return: clean(req.body.permit_time_return),
      permit_reason: clean(req.body.permit_reason),
      permit_full_day: req.body.permit_full_day ? 1 : 0,
      lunch_out: lunchOut,
      lunch_in: lunchIn,
      exit_time: exit
    };

    await updateAttendanceRecord(existing.id, record);
    if (certificate) {
      await saveCertificate({
        worker_id: existing.worker_id,
        record_date: recordDate,
        file_name: certificate.file_name,
        mime_type: certificate.mime_type,
        data_base64: certificate.data_base64,
        uploaded_by: record.registered_by
      });
    }
    res.json({ ok: true });
  } catch (error) {
    if (error.message === 'REGISTRO_DUPLICADO') {
      return res.status(409).json({ ok: false, error: 'Ya existe un registro para ese trabajador en esa fecha.' });
    }
    next(error);
  }
});

attendanceRouter.post('/registro/eliminar', async (req, res, next) => {
  try {
    const deleted = await deleteAttendanceRecord(clean(req.body.id));
    if (!deleted) return res.status(404).json({ ok: false, error: 'El registro ya no existe.' });
    res.json({ ok: true });
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
  const title = branch ? `Asistencia · ${branch}` : 'Registro de asistencia';
  res.status(422).render('attendance/index', {
    title,
    date,
    branch,
    saved: 0,
    imported: 0,
    canImport: branch === biometricBranch,
    biometricBranch,
    branches: data.branches,
    ...data,
    statuses: attendanceStatuses,
    errors,
    exportQuery
  });
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

function biometricErrorMessage(code) {
  switch (code) {
    case 'REPORTE_VACIO':
      return 'El archivo esta vacio.';
    case 'REPORTE_INVALIDO':
      return 'El archivo no es un Excel valido.';
    case 'REPORTE_SIN_HOJAS':
      return 'El Excel no tiene hojas para leer.';
    case 'REPORTE_SIN_RANGO':
      return 'No se encontro el rango de fechas (Statistics Date) en el reporte.';
    case 'REPORTE_SIN_DIAS':
      return 'No se encontro la fila con los dias del mes.';
    case 'REPORTE_SIN_TRABAJADORES':
      return 'No se encontraron trabajadores con marcas en el reporte.';
    default:
      return 'No se pudo interpretar el reporte del biometrico.';
  }
}

function sanitizeTime(value) {
  const text = clean(value);
  if (!text) return { value: '', valid: true };
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text);
  if (!match) return { value: '', valid: false };
  return { value: `${match[1].padStart(2, '0')}:${match[2]}`, valid: true };
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
    lunch_in: clean(body.lunch_in),
    exit_time: clean(body.exit_time)
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
  if (record.status === 'ATRASO' && (!requireText(record.scheduled_entry_time) || !requireText(record.actual_arrival_time))) errors.push('Ingrese la hora establecida y la hora real de llegada.');
  return errors;
}

function byName(a, b) {
  return a.full_name.localeCompare(b.full_name);
}

function calculateLateMinutes({ status, entry, scheduled, expectedEntry, lunchOut, lunchIn, exit }) {
  // Solo los estados de asistencia generan minutos de atraso; un dia libre, falta, vacaciones o permiso no.
  if (status !== 'ASISTENCIA NORMAL' && status !== 'ATRASO') return 0;
  let lateMinutes = 0;
  if (status === 'ATRASO') {
    if (scheduled && entry) lateMinutes += minutesBetween(scheduled, entry);
  } else if (entry) {
    // Entrada: solo penaliza si se pasa de la hora esperada.
    lateMinutes += minutesBetween(expectedEntry || '07:00', entry);
  }
  // Almuerzo: puede tomarse a cualquier hora del dia; solo penaliza si dura mas de 60 minutos.
  if (lunchOut && lunchIn) {
    lateMinutes += Math.max(minutesBetween(lunchOut, lunchIn) - 60, 0);
  }
  // Salida: solo penaliza si el trabajador se va ANTES de las 18:00.
  if (exit) lateMinutes += minutesBetween(exit, '18:00');
  return lateMinutes;
}
