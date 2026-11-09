import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const configuredFile = process.env.DATABASE_FILE || path.join('data', 'asistencias.db');
const databaseFile = path.resolve(configuredFile);

if (!fs.existsSync(databaseFile)) {
  console.error(`No existe la base de datos: ${databaseFile}`);
  console.error('Ejecute primero "npm run migrate" o inicie la aplicacion una vez.');
  process.exit(1);
}

const backupDir = path.join(path.dirname(databaseFile), 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(backupDir, `asistencias-${stamp}.db`);

const db = new DatabaseSync(databaseFile);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

console.log(`Respaldo creado: ${target}`);
