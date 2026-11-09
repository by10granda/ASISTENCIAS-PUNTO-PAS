import 'dotenv/config';
import * as db from '../src/dbStore.js';
import {
  initStore as initSheetsStore,
  listAttendance,
  listAttentionCalls,
  listBranches,
  listJobAbandonments,
  listMedicalWithdrawals,
  listVacationDeductions,
  listVacations,
  listWorkers
} from '../src/sheetsStore.js';

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  section('1/3 Leyendo datos de Google Sheets...');
  await initSheetsStore();

  const [workers, branches, attendance, vacations, vacationDeductions, attentionCalls, jobAbandonments, medicalWithdrawals] = await Promise.all([
    listWorkers(),
    listBranches(),
    listAttendance(),
    listVacations(),
    listVacationDeductions(),
    listAttentionCalls(),
    listJobAbandonments(),
    listMedicalWithdrawals()
  ]);

  const dataset = { workers, branches, attendance, vacations, vacationDeductions, attentionCalls, jobAbandonments, medicalWithdrawals };

  section('2/3 Creando esquema SQLite...');
  await db.initStore();
  console.log(`Archivo de base de datos: ${db.databaseFile}`);

  section('3/3 Copiando registros...');
  const imported = await db.importAll(dataset);

  console.log('\nMigracion completada:');
  for (const [key, total] of Object.entries(imported)) {
    console.log(`  ${key}: ${total}`);
  }
  const totalRegistros = Object.values(imported).reduce((sum, value) => sum + value, 0);
  console.log(`  TOTAL: ${totalRegistros}`);
  console.log('\nListo. La aplicacion ya puede usar la base de datos local.');
}

main().catch((error) => {
  console.error('\nError durante la migracion:', error.message);
  if (/GOOGLE_|Faltan variables/i.test(error.message)) {
    console.error('Verifique GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en el archivo .env.');
  }
  process.exitCode = 1;
});
