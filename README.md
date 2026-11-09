# Control de Asistencia de Trabajadores

Sistema web basico, moderno y responsive para registrar trabajadores, asistencia diaria, novedades, vacaciones, historial y reportes mensuales. Esta version guarda la informacion en una base de datos SQLite local (integrada en Node.js) y puede publicarse en Internet con Cloudflare Tunnel. Tambien conserva soporte opcional para Google Sheets durante la transicion.

Guia de migracion y Cloudflare Tunnel: `MIGRACION_BASE_DATOS.md`.
Manual de uso: `MANUAL_USUARIO.md`.

## Analisis de requerimientos

Con SQLite local el sistema soporta sin problema el volumen de 35 trabajadores (aproximadamente 12.775 registros de asistencia por ano) y no depende de limites ni cuotas de Google Sheets.

El sistema mantiene una regla clave: un trabajador no debe tener dos registros de asistencia para la misma fecha. En SQLite se aplica con la restriccion `UNIQUE (worker_id, record_date)`, que funciona incluso si dos usuarios guardan al mismo tiempo. Con Google Sheets la regla se validaba solo desde la aplicacion.

## Estructura del sistema

- `src/server.js`: configuracion de Express, dashboard y modulos.
- `src/store.js`: selector de almacenamiento (`sqlite`, `remote` o `sheets`).
- `src/dbStore.js`: conexion y operaciones con la base de datos SQLite local.
- `src/remoteStore.js`: adaptador que consume la API del servidor (modo Vercel).
- `src/apiServer.js`: API de datos que expone SQLite por Cloudflare Tunnel.
- `src/sheetsStore.js`: conexion y operaciones con Google Sheets (opcional).
- `src/routes/`: trabajadores, asistencia, vacaciones, historial y reportes.
- `src/views/`: pantallas EJS.
- `public/css` y `public/js`: estilos y comportamiento de formularios.
- `scripts/migrate-from-sheets.js`: copia los datos de Google Sheets a SQLite.
- `scripts/backup.js`: genera un respaldo consistente de la base de datos.
- `cloudflared/config.example.yml`: configuracion de ejemplo del tunel.
- `ARQUITECTURA_VERCEL.md`: pagina en Vercel + base de datos en el servidor.
- `PASOS_SERVIDOR.md`: pasos para ejecutar todo en el servidor Windows.
- `api/index.js`: entrada serverless para Vercel (opcional).
- `vercel.json`: reescritura de rutas hacia Vercel Functions (opcional).

## Base de datos local (SQLite)

Por defecto la aplicacion usa SQLite mediante el modulo integrado `node:sqlite`.
No hay que instalar ningun motor ni abrir puertos: la base es un archivo
`data/asistencias.db`.

```bash
npm install
npm run migrate   # solo si viene de Google Sheets
npm start
```

- Abrir `http://localhost:3000`.
- `DATA_BACKEND=sqlite` es el valor por defecto.
- `DATA_BACKEND=sheets` vuelve temporalmente a Google Sheets.
- `npm run backup` crea una copia en `data/backups/`.
- La tabla `attendance_records` tiene `UNIQUE (worker_id, record_date)`, por lo
  que la base impide duplicados aunque dos usuarios guarden a la vez.

Guia completa para Windows y Cloudflare Tunnel: `MIGRACION_BASE_DATOS.md`.

## Pagina en Vercel + base de datos en el servidor

Tambien es posible desplegar la pagina en Vercel desde GitHub y dejar la base
SQLite en el servidor, comunicandose por Cloudflare Tunnel:

```text
Vercel (pagina) --HTTPS--> api.sudominio.com --Tunnel--> API :3001 --> SQLite
```

- En Vercel: `DATA_BACKEND=remote`, `STORE_API_URL` y `STORE_API_TOKEN`.
- En el servidor: `npm run api` (API de datos) y el tunel apuntando al puerto 3001.
- La pagina nunca accede al archivo de la base: solo a la API autenticada.

Guia paso a paso: `ARQUITECTURA_VERCEL.md`.

Sitio publicado: **https://asistencias-punto-pas.vercel.app** (usuario `admin`).
Cada `git push` a `main` se despliega automaticamente en Vercel.

## Hojas de Google Sheets (opcional / legado)

El sistema crea automaticamente estas hojas dentro del archivo configurado:

- `workers`
- `attendance_records`
- `vacations`
- `attention_calls`
- `job_abandonments`
- `medical_withdrawals`

Tambien crea los encabezados necesarios si no existen.

## Tablas logicas

### `workers`

- `id`
- `full_name`
- `cedula`
- `position`
- `branch`
- `hire_date`
- `status`
- `created_at`
- `updated_at`

### `attendance_records`

- `id`
- `worker_id`
- `record_date`
- `status`
- `entry_time`
- `scheduled_entry_time`
- `actual_arrival_time`
- `late_minutes`
- `observation`
- `registered_by`
- `justified_reason`
- `has_support_doc`
- `permit_time_out`
- `permit_time_return`
- `permit_reason`
- `permit_full_day`
- `created_at`
- `updated_at`

### `vacations`

- `id`
- `worker_id`
- `start_date`
- `end_date`
- `total_days`
- `observation`
- `status`
- `created_at`
- `updated_at`

## Pantallas

- Panel principal con estadisticas del dia y resumen mensual.
- Trabajadores: registro, edicion, activacion/desactivacion y busqueda.
- Asistencia: registro diario con campos dinamicos.
- Vacaciones: registro de periodos.
- Historial: filtros por trabajador, fecha, rango, mes, sucursal y tipo.
- Reportes: reporte mensual individual o general.
- Novedades: registro de llamados de atencion, abandonos de trabajo y retiros por accidente laboral o enfermedad por trabajador.

## Crear credenciales de Google Sheets

1. Crear un archivo de Google Sheets.
2. Copiar el ID del archivo desde la URL.

Ejemplo:

```text
https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
```

3. Entrar a Google Cloud Console.
4. Crear un proyecto o usar uno existente.
5. Activar la API `Google Sheets API`.
6. Crear una cuenta de servicio.
7. Generar una clave JSON para la cuenta de servicio.
8. Compartir el Google Sheets con el correo de la cuenta de servicio como editor.

El correo se ve parecido a:

```text
asistencias@mi-proyecto.iam.gserviceaccount.com
```

## Variables de entorno

Variables principales (base de datos local):

```text
DATA_BACKEND=sqlite
DATABASE_FILE=./data/asistencias.db
APP_TIME_ZONE=America/Guayaquil
```

Autenticacion basica opcional si se publica en Internet:

```text
APP_USERNAME=admin
APP_PASSWORD=UnaClaveLargaYSegura
```

Variables solo necesarias para migrar desde Google Sheets o usar
`DATA_BACKEND=sheets`:

```text
GOOGLE_SHEETS_ID=ID_DEL_ARCHIVO_DE_SHEETS
GOOGLE_SERVICE_ACCOUNT_EMAIL=correo-de-la-cuenta@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Importante: mantener los `\n` dentro de `GOOGLE_PRIVATE_KEY` o usar el valor
completo de `private_key` del JSON.

## Instalacion local

1. Instalar Node.js 22.5 o superior (recomendado Node.js 24 LTS).
2. Instalar dependencias:

```bash
npm install
```

3. Copiar `.env.example` a `.env` y ajustar `DATABASE_FILE`, zona horaria y
   credenciales de Google solo si va a migrar.
4. Si viene de Google Sheets, copiar los datos:

```bash
npm run migrate
```

5. Ejecutar:

```bash
npm start
```

6. Abrir:

```text
http://localhost:3000
```

## Despliegue con Cloudflare Tunnel

La aplicacion esta pensada para ejecutarse en un servidor Windows y publicarse
con Cloudflare Tunnel. Ver la guia paso a paso en `MIGRACION_BASE_DATOS.md`.

Resumen:

1. `npm start` deja la aplicacion en `http://localhost:3000`.
2. `cloudflared tunnel` publica solo la aplicacion (no la base de datos).
3. El dominio queda con HTTPS sin abrir puertos en el router.

Vercel ya no es necesario. Si se usa Vercel, la base SQLite local no es
persistente alli; en ese caso se necesitaria una base remota.

## Notas importantes

- SQLite es gratuito, viene integrado en Node y soporta de sobra el volumen de
  35 trabajadores.
- La restriccion `UNIQUE (worker_id, record_date)` evita duplicados de asistencia
  a nivel de base de datos.
- No guarde la base de datos en una carpeta sincronizada con OneDrive, Dropbox o
  Google Drive.
- Programe `npm run backup` para tener copias en `data/backups/`.
- Si el sistema crece mucho, la migracion natural seria PostgreSQL o MySQL; la
  capa `src/dbStore.js` centraliza el acceso para facilitar ese cambio.
