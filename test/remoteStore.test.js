import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistencias-remote-'));
process.env.DATABASE_FILE = path.join(tempDir, 'remote.db');
process.env.STORE_API_TOKEN = 'token-de-prueba';
process.env.STORE_API_PORT = '0';
process.env.STORE_API_TIMEOUT_MS = '5000';

const db = await import('../src/dbStore.js');
await db.initStore();

const { default: apiApp } = await import('../src/apiServer.js');
const server = apiApp.listen(0, '127.0.0.1');
await once(server, 'listening');
process.env.STORE_API_URL = `http://127.0.0.1:${server.address().port}`;

const remote = await import('../src/remoteStore.js');

after(() => {
  server.closeAllConnections?.();
  server.close();
});

test('la API rechaza peticiones sin token', async () => {
  const response = await fetch(`${process.env.STORE_API_URL}/api/store/listWorkers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [] })
  });
  assert.equal(response.status, 401);
});

test('remoteStore.initStore valida el servicio', async () => {
  await remote.initStore();
});

test('crea sucursales por la API remota', async () => {
  await remote.createBranch('Matriz');
  const branches = await remote.listBranches();
  assert.equal(branches.length, 1);
  assert.equal(branches[0].name, 'Matriz');
  await assert.rejects(() => remote.createBranch('MATRIZ'), /DUPLICATE_BRANCH/);
});

test('crea, busca y actualiza trabajadores por la API remota', async () => {
  await remote.createWorker({
    full_name: 'Carlos Remoto',
    cedula: '999888777',
    position: 'Bodeguero',
    branch: 'Matriz',
    hire_date: '2025-03-01',
    status: 'Activo'
  });

  const workers = await remote.listWorkers();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].full_name, 'Carlos Remoto');

  const worker = await remote.findWorker(workers[0].id);
  assert.equal(worker.cedula, '999888777');

  await assert.rejects(() => remote.createWorker({
    full_name: 'Otro',
    cedula: '999888777',
    position: 'Bodeguero',
    branch: 'Matriz',
    hire_date: '2025-03-01',
    status: 'Activo'
  }), /DUPLICATE_CEDULA/);

  await remote.updateWorker(worker.id, { ...worker, full_name: 'Carlos Actualizado' });
  assert.equal((await remote.findWorker(worker.id)).full_name, 'Carlos Actualizado');
});

test('upsert de asistencia por la API remota', async () => {
  const worker = (await remote.listWorkers())[0];
  const base = {
    worker_id: worker.id,
    record_date: '2026-11-09',
    status: 'ATRASO',
    entry_time: '08:10',
    scheduled_entry_time: '08:00',
    actual_arrival_time: '08:10',
    late_minutes: 10,
    observation: '',
    registered_by: 'Admin',
    justified_reason: '',
    has_support_doc: 0,
    permit_time_out: '',
    permit_time_return: '',
    permit_reason: '',
    permit_full_day: 0
  };

  await remote.upsertAttendance(base);
  await remote.upsertAttendance({ ...base, status: 'ASISTENCIA NORMAL', late_minutes: 0 });

  const records = await remote.listAttendance();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'ASISTENCIA NORMAL');
});

test('registra vacaciones y novedades por la API remota', async () => {
  const worker = (await remote.listWorkers())[0];
  await remote.createVacation({
    worker_id: worker.id,
    start_date: '2026-12-01',
    end_date: '2026-12-03',
    total_days: 3,
    observation: '',
    status: 'Programadas'
  });
  await remote.createVacationDeduction({
    worker_id: worker.id,
    days: 1,
    reason: 'Permiso',
    record_date: '2026-11-01',
    registered_by: 'Admin'
  });
  await remote.createAttentionCall({
    worker_id: worker.id,
    record_date: '2026-11-02',
    reason: 'Llamado',
    description: 'Detalle',
    registered_by: 'Admin'
  });
  await remote.createJobAbandonment({
    worker_id: worker.id,
    record_date: '2026-11-03',
    exit_time: '10:00',
    reason: 'Abandono',
    observation: '',
    registered_by: 'Admin'
  });
  await remote.createMedicalWithdrawal({
    worker_id: worker.id,
    record_date: '2026-11-04',
    exit_time: '09:00',
    cause: 'Enfermedad',
    description: 'Reposo',
    has_support_doc: 1,
    registered_by: 'Admin'
  });

  assert.equal((await remote.listVacations())[0].total_days, 3);
  assert.equal((await remote.listVacationDeductions())[0].days, 1);
  assert.equal((await remote.listAttentionCalls()).length, 1);
  assert.equal((await remote.listJobAbandonments()).length, 1);
  assert.equal((await remote.listMedicalWithdrawals())[0].has_support_doc, 1);
});
