import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistencias-db-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');

const db = await import('../src/dbStore.js');

test('inicializa el esquema sin datos', async () => {
  await db.initStore();
  assert.deepEqual(await db.listWorkers(), []);
  assert.deepEqual(await db.listAttendance(), []);
});

test('crea sucursales y evita duplicados sin distinguir mayusculas', async () => {
  await db.createBranch('Matriz');
  await db.createBranch('Norte');
  assert.equal((await db.listBranches()).length, 2);
  await assert.rejects(() => db.createBranch('MATRIZ'), /DUPLICATE_BRANCH/);
});

test('gestiona trabajadores con cedula unica', async () => {
  await db.createWorker({
    full_name: 'Ana Perez',
    cedula: '0102030405',
    position: 'Cajera',
    branch: 'Matriz',
    hire_date: '2024-01-15',
    status: 'Activo'
  });

  const worker = (await db.listWorkers())[0];
  assert.equal(typeof worker.id, 'string');
  assert.equal(worker.full_name, 'Ana Perez');

  await assert.rejects(() => db.createWorker({
    full_name: 'Otra Persona',
    cedula: '0102030405',
    position: 'Cajera',
    branch: 'Matriz',
    hire_date: '2024-02-01',
    status: 'Activo'
  }), /DUPLICATE_CEDULA/);

  assert.equal(await db.updateWorker(worker.id, { ...worker, full_name: 'Ana Maria Perez' }), true);
  assert.equal((await db.findWorker(worker.id)).full_name, 'Ana Maria Perez');
});

test('asistencia hace upsert por trabajador y fecha', async () => {
  const worker = (await db.listWorkers())[0];
  const base = {
    worker_id: worker.id,
    record_date: '2026-11-08',
    status: 'ATRASO',
    entry_time: '08:15',
    scheduled_entry_time: '08:00',
    actual_arrival_time: '08:15',
    late_minutes: 15,
    observation: '',
    registered_by: 'Admin',
    justified_reason: '',
    has_support_doc: 0,
    permit_time_out: '',
    permit_time_return: '',
    permit_reason: '',
    permit_full_day: 0
  };

  await db.upsertAttendance(base);
  await db.upsertAttendance({ ...base, status: 'ASISTENCIA NORMAL', late_minutes: 0 });

  const records = await db.listAttendance();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'ASISTENCIA NORMAL');
  assert.equal(records[0].late_minutes, 0);
  assert.equal(typeof records[0].worker_id, 'string');
});

test('registra vacaciones, bajas y novedades', async () => {
  const worker = (await db.listWorkers())[0];
  await db.createVacation({
    worker_id: worker.id,
    start_date: '2026-12-01',
    end_date: '2026-12-05',
    total_days: 5,
    observation: '',
    status: 'Programadas'
  });
  await db.createVacationDeduction({
    worker_id: worker.id,
    days: 1,
    reason: 'Permiso especial',
    record_date: '2026-11-01',
    registered_by: 'Admin'
  });
  await db.createAttentionCall({
    worker_id: worker.id,
    record_date: '2026-11-02',
    reason: 'Tardanza reiterada',
    description: 'Tercera tardanza del mes',
    registered_by: 'Admin'
  });
  await db.createJobAbandonment({
    worker_id: worker.id,
    record_date: '2026-11-03',
    exit_time: '10:00',
    reason: 'Abandono',
    observation: '',
    registered_by: 'Admin'
  });
  await db.createMedicalWithdrawal({
    worker_id: worker.id,
    record_date: '2026-11-04',
    exit_time: '09:00',
    cause: 'Enfermedad',
    description: 'Reposo',
    has_support_doc: 1,
    registered_by: 'Admin'
  });

  assert.equal((await db.listVacations())[0].total_days, 5);
  assert.equal((await db.listVacationDeductions())[0].days, 1);
  assert.equal((await db.listAttentionCalls()).length, 1);
  assert.equal((await db.listJobAbandonments()).length, 1);
  assert.equal((await db.listMedicalWithdrawals())[0].has_support_doc, 1);
});

test('importa datos conservando ids y relaciones', async () => {
  const imported = await db.importAll({
    workers: [
      { id: '10', full_name: 'Luis Uno', cedula: '111', position: 'Guardia', branch: 'Matriz', hire_date: '2023-01-01', status: 'Activo', created_at: '', updated_at: '' }
    ],
    branches: [{ id: '5', name: 'Matriz', created_at: '', updated_at: '' }],
    attendance: [
      { id: '20', worker_id: '10', record_date: '2026-11-01', status: 'ASISTENCIA NORMAL', entry_time: '08:00', scheduled_entry_time: '', actual_arrival_time: '', late_minutes: '0', observation: '', registered_by: 'Admin', justified_reason: '', has_support_doc: '0', permit_time_out: '', permit_time_return: '', permit_reason: '', permit_full_day: '0', created_at: '', updated_at: '' },
      { id: '21', worker_id: '999', record_date: '2026-11-01', status: 'ATRASO', entry_time: '', scheduled_entry_time: '', actual_arrival_time: '', late_minutes: '0', observation: '', registered_by: '', justified_reason: '', has_support_doc: '0', permit_time_out: '', permit_time_return: '', permit_reason: '', permit_full_day: '0', created_at: '', updated_at: '' }
    ]
  });

  assert.equal(imported.workers, 1);
  assert.equal(imported.attendance, 1, 'descarta registros huerfanos');
  const worker = (await db.listWorkers())[0];
  assert.equal(worker.id, '10');
  const record = (await db.listAttendance())[0];
  assert.equal(record.worker_id, '10');
  assert.equal(record.id, '20');
});

test('eliminar trabajador borra sus registros relacionados', async () => {
  const worker = (await db.listWorkers())[0];
  assert.equal(await db.deleteWorkerAndData(worker.id), true);
  assert.deepEqual(await db.listWorkers(), []);
  assert.deepEqual(await db.listAttendance(), []);
  assert.equal(await db.deleteWorkerAndData(worker.id), false);
});
