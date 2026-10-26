import { completedYears, daysInclusive } from './utils.js';

export const VACATION_DAYS_PER_YEAR = 15;
export const DEDUCTIBLE_VACATION_STATUSES = new Set(['Programadas', 'En curso', 'Finalizadas']);

export function vacationBalance(worker, vacations, deductions, asOf) {
  const completed = completedYears(worker.hire_date, asOf);
  const earned = completed * VACATION_DAYS_PER_YEAR;
  const used = vacations
    .filter((vacation) => vacation.worker_id === worker.id && DEDUCTIBLE_VACATION_STATUSES.has(vacation.status))
    .reduce((total, vacation) => total + daysInclusive(vacation.start_date, vacation.end_date), 0);
  const writtenOff = deductions
    .filter((deduction) => deduction.worker_id === worker.id)
    .reduce((total, deduction) => total + (Number(deduction.days) || 0), 0);
  return { completed_years: completed, earned_days: earned, used_days: used, written_off_days: writtenOff, available_days: earned - used - writtenOff };
}

export function vacationDaysInRange(records, vacations, reportStart, reportEnd) {
  const dates = new Set(records
    .filter((record) => record.status === 'VACACIONES' && record.record_date >= reportStart && record.record_date <= reportEnd)
    .map((record) => record.record_date));
  vacations.forEach((vacation) => {
    const start = vacation.start_date > reportStart ? vacation.start_date : reportStart;
    const end = vacation.end_date < reportEnd ? vacation.end_date : reportEnd;
    const current = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (current <= last) {
      dates.add(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  });
  return dates.size;
}
