import test from 'node:test';
import assert from 'node:assert/strict';
import { completedYears, daysInclusive, isValidDate } from '../src/utils.js';
import { vacationBalance, vacationDaysInRange } from '../src/vacationPolicy.js';

test('cuenta dias calendario de forma inclusiva', () => {
  assert.equal(daysInclusive('2026-10-26', '2026-10-26'), 1);
  assert.equal(daysInclusive('2026-10-30', '2026-11-02'), 4);
  assert.equal(daysInclusive('2026-11-02', '2026-10-30'), 0);
});

test('valida fechas calendario reales', () => {
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2025-02-29'), false);
  assert.equal(isValidDate('2026-13-01'), false);
});

test('genera 15 dias por cada ano cumplido', () => {
  assert.equal(completedYears('2025-10-27', '2026-10-26'), 0);
  assert.equal(completedYears('2025-10-26', '2026-10-26'), 1);
  assert.equal(completedYears('2023-10-26', '2026-10-26'), 3);
});

test('calcula saldo restando vacaciones y bajas', () => {
  const worker = { id: '1', hire_date: '2023-10-26' };
  const vacations = [
    { worker_id: '1', start_date: '2026-01-01', end_date: '2026-01-05', status: 'Finalizadas' },
    { worker_id: '1', start_date: '2026-12-01', end_date: '2026-12-03', status: 'Programadas' },
    { worker_id: '1', start_date: '2026-06-01', end_date: '2026-06-01', status: 'En curso' },
    { worker_id: '1', start_date: '2026-07-01', end_date: '2026-07-05', status: 'Canceladas' }
  ];
  const deductions = [{ worker_id: '1', days: 2 }];
  assert.deepEqual(vacationBalance(worker, vacations, deductions, '2026-10-26'), {
    completed_years: 3,
    earned_days: 45,
    used_days: 9,
    written_off_days: 2,
    available_days: 34
  });
});

test('cuenta fechas de vacaciones sin duplicar rangos y registros diarios', () => {
  const records = [
    { record_date: '2026-10-02', status: 'VACACIONES' },
    { record_date: '2026-10-10', status: 'FALTA JUSTIFICADA' }
  ];
  const vacations = [{ start_date: '2026-10-01', end_date: '2026-10-03' }];
  assert.equal(vacationDaysInRange(records, vacations, '2026-10-01', '2026-10-31'), 3);
});
