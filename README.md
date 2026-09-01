# Control de Asistencia de Trabajadores

Sistema web basico, moderno y responsive para registrar trabajadores, asistencia diaria, novedades, vacaciones, historial y reportes mensuales. Esta version guarda la informacion en Google Sheets y esta preparada para desplegar en Vercel.

Manual de uso: `MANUAL_USUARIO.md`.

## Analisis de requerimientos

Para 35 trabajadores, Google Sheets es suficiente si el sistema lo usan pocos administradores. El volumen aproximado seria de 12.775 registros de asistencia por ano, muy por debajo del limite de Google Sheets.

El sistema mantiene una regla clave: un trabajador no debe tener dos registros de asistencia para la misma fecha. Como Sheets no tiene restricciones SQL, la aplicacion aplica esta regla buscando `worker_id + record_date`: si ya existe, actualiza la fila; si no existe, crea una nueva.

## Estructura del sistema

- `src/server.js`: configuracion de Express, dashboard y modulos.
- `src/sheetsStore.js`: conexion y operaciones con Google Sheets.
- `src/routes/`: trabajadores, asistencia, vacaciones, historial y reportes.
- `src/views/`: pantallas EJS.
- `public/css` y `public/js`: estilos y comportamiento de formularios.
- `api/index.js`: entrada serverless para Vercel.
- `vercel.json`: reescritura de rutas hacia Vercel Functions.

## Hojas de Google Sheets

El sistema crea automaticamente estas hojas dentro del archivo configurado:

- `workers`
- `attendance_records`
- `vacations`

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

Crear estas variables en local y en Vercel:

```text
GOOGLE_SHEETS_ID=ID_DEL_ARCHIVO_DE_SHEETS
GOOGLE_SERVICE_ACCOUNT_EMAIL=correo-de-la-cuenta@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Importante: en Vercel, pegar `GOOGLE_PRIVATE_KEY` manteniendo los `\n` o usando el valor completo de `private_key` del JSON.

## Instalacion local

1. Instalar Node.js 22.5 o superior.
2. Instalar dependencias:

```bash
npm install
```

3. Configurar las variables de entorno.

En PowerShell:

```powershell
$env:GOOGLE_SHEETS_ID="ID_DEL_ARCHIVO"
$env:GOOGLE_SERVICE_ACCOUNT_EMAIL="correo@proyecto.iam.gserviceaccount.com"
$env:GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

4. Ejecutar:

```bash
npm start
```

5. Abrir:

```text
http://localhost:3000
```

## Despliegue en Vercel

1. Subir el proyecto a GitHub.
2. Importar el repositorio en Vercel.
3. Agregar las variables de entorno:

```text
GOOGLE_SHEETS_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

4. Desplegar.

## Notas importantes

- Google Sheets funciona bien para este caso de 35 trabajadores.
- Si dos usuarios guardan exactamente al mismo tiempo el mismo trabajador y fecha, Sheets no ofrece bloqueo transaccional como una base de datos SQL. Para uso administrativo normal es aceptable.
- Si el sistema crece mucho, la mejor migracion seria Supabase PostgreSQL o Neon.
