# Migracion a base de datos local + Cloudflare Tunnel

Esta guia explica como dejar de usar Google Sheets y trabajar con una base de datos
SQLite en un servidor Windows, publicando la aplicacion por Cloudflare Tunnel.

## Como queda la arquitectura

```text
Internet
  |  HTTPS
  v
Cloudflare (dominio + certificado)
  |
  v
Cloudflare Tunnel (cloudflared en Windows)
  |
  v
Aplicacion Node/Express en http://localhost:3000
  |
  v
data/asistencias.db  (SQLite, solo en el servidor)
```

Puntos clave:

- La base de datos **no se publica** en Internet. Solo se publica la aplicacion.
- No hace falta abrir puertos en el router ni contratar IP fija.
- No hay costo de base de datos: SQLite viene integrado en Node (`node:sqlite`).

## Requisitos

- Node.js 22.5 o superior (recomendado Node.js 24 LTS).
- Cuenta de Cloudflare con un dominio agregado.
- El proyecto copiado en una carpeta local del servidor.

> Importante: no deje la base de datos dentro de una carpeta sincronizada con
> OneDrive, Dropbox o Google Drive. La sincronizacion puede corromper archivos
> SQLite. Use una ruta como `C:\asistencias`.

Compruebe la version de Node:

```powershell
node -v
```

## 1. Instalar dependencias

```powershell
cd C:\asistencias
npm install
```

## 2. Configurar el archivo .env

Cree o edite `.env` en la raiz del proyecto:

```text
DATA_BACKEND=sqlite
DATABASE_FILE=./data/asistencias.db
APP_TIME_ZONE=America/Guayaquil

APP_USERNAME=admin
APP_PASSWORD=UnaClaveLargaYSegura

# Necesarias solo para migrar desde Google Sheets
GOOGLE_SHEETS_ID=ID_DEL_ARCHIVO
GOOGLE_SERVICE_ACCOUNT_EMAIL=correo@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

- `DATA_BACKEND=sqlite` usa la base local.
- Si define `APP_USERNAME` y `APP_PASSWORD`, el navegador pedira usuario y
  contrasena antes de mostrar la aplicacion. **Recomendado** si va a estar en
  Internet.
- Para volver temporalmente a Sheets: `DATA_BACKEND=sheets`.

## 3. Migrar los datos existentes

Con las credenciales de Google configuradas, ejecute:

```powershell
npm run migrate
```

El script:

1. Lee todas las hojas de Google Sheets.
2. Crea el esquema de la base de datos.
3. Copia los registros conservando los ids y relaciones.
4. Descarta registros huerfanos (por ejemplo asistencia de un trabajador que ya
   no existe) para respetar las llaves foraneas.

La migracion **reemplaza** el contenido actual de `data/asistencias.db`. Si ya
tenia datos en la base local, haga un respaldo antes:

```powershell
npm run backup
```

### Migrar desde otro equipo

Si las credenciales de Google estan en su PC y el servidor no tiene acceso a
ellas:

1. En su PC: `npm run migrate`.
2. Detenga la aplicacion en el servidor.
3. Copie `data/asistencias.db` al servidor, en la misma ruta relativa.
4. No copie `asistencias.db-wal` ni `asistencias.db-shm` si la aplicacion esta
   detenida; el archivo `.db` ya contiene todo.

## 4. Probar la aplicacion

```powershell
npm start
```

Abra:

```text
http://localhost:3000
```

Verifique trabajadores, asistencia, vacaciones, novedades, historial y reportes.

### Ventaja de la base de datos

En `attendance_records` existe la restriccion:

```sql
UNIQUE (worker_id, record_date)
```

Esto garantiza a nivel de base de datos que un trabajador no pueda tener dos
registros de asistencia en la misma fecha, aunque dos usuarios guarden al mismo
tiempo. Antes esa regla solo se validaba desde la aplicacion.

## 5. Instalar Cloudflare Tunnel

### 5.1 Instalar cloudflared

Con winget (PowerShell como administrador):

```powershell
winget install --id Cloudflare.cloudflared
```

Tambien puede descargar el `.exe` desde la pagina oficial de Cloudflare y
guardarlo en `C:\Cloudflared\bin\cloudflared.exe`.

### 5.2 Autenticarse y crear el tunel

```powershell
cloudflared tunnel login
cloudflared tunnel create asistencias
cloudflared tunnel list
```

Guarde el **Tunnel ID** que muestra el ultimo comando y el archivo
`<TUNNEL-ID>.json` generado en `C:\Users\<usuario>\.cloudflared\`.

### 5.3 Crear el registro DNS

Reemplace el dominio por el suyo:

```powershell
cloudflared tunnel route dns asistencias asistencias.sudominio.com
```

### 5.4 Crear config.yml

Cree `C:\Users\<usuario>\.cloudflared\config.yml` basandose en
`cloudflared/config.example.yml`:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<usuario>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: asistencias.sudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

Valide la configuracion:

```powershell
cloudflared tunnel ingress validate
```

### 5.5 Probar el tunel manualmente

Con la aplicacion corriendo (`npm start`), en otra terminal:

```powershell
cloudflared tunnel run asistencias
```

Abra `https://asistencias.sudominio.com`. Si funciona, detenga el comando con
`Ctrl+C` y continue con el servicio.

### 5.6 Instalar el tunel como servicio de Windows

Abra **CMD como administrador**:

```cmd
cloudflared.exe service install
mkdir C:\Windows\System32\config\systemprofile\.cloudflared
```

Copie los archivos al perfil del sistema:

```cmd
copy C:\Users\<usuario>\.cloudflared\cert.pem C:\Windows\System32\config\systemprofile\.cloudflared\cert.pem
copy C:\Users\<usuario>\.cloudflared\<TUNNEL-ID>.json C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL-ID>.json
copy C:\Users\<usuario>\.cloudflared\config.yml C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
```

> El servicio corre con la cuenta SYSTEM, por eso lee la configuracion desde
> `C:\Windows\System32\config\systemprofile\.cloudflared\`, no desde su usuario.

Verifique que el `credentials-file` dentro de `config.yml` apunte a esa misma
ruta.

Ajuste el comando de inicio del servicio en el Registro de Windows:

1. Abra `regedit`.
2. Vaya a `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Cloudflared`.
3. Edite `ImagePath` y deje:

```text
C:\Cloudflared\bin\cloudflared.exe --config=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run
```

4. Inicie el servicio:

```cmd
sc start cloudflared
```

Cada cambio en `config.yml` requiere reiniciar el servicio:

```cmd
sc stop cloudflared
sc start cloudflared
```

## 6. Mantener la aplicacion Node corriendo

El tunel publica el puerto 3000, pero alguien debe mantener vivo el proceso de
Node. Use una de estas opciones.

### Opcion A: PM2 (recomendado)

```powershell
npm install -g pm2
pm2 start src/server.js --name asistencias --node-args="--experimental-sqlite --disable-warning=ExperimentalWarning"
pm2 save
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

Comandos utiles:

```powershell
pm2 status
pm2 logs asistencias
pm2 restart asistencias
```

### Opcion B: Programador de tareas de Windows

1. Abra **Programador de tareas**.
2. Crear tarea -> **Al iniciar el equipo**.
3. Accion: iniciar un programa.
4. Programa: `C:\Program Files\nodejs\node.exe`
5. Argumentos:

```text
--experimental-sqlite --disable-warning=ExperimentalWarning src\server.js
```

6. Iniciar en: `C:\asistencias`

## 7. Respaldo de la base de datos

Ejecute periodicamente:

```powershell
npm run backup
```

Los respaldos se guardan en `data\backups\asistencias-FECHA.db`. Copie esa
carpeta a otro disco o a la nube (no la carpeta `data` activa).

Puede programar el respaldo diario con el Programador de tareas de Windows.

## 8. Seguridad recomendada

La aplicacion no trae inicio de sesion propio. Antes de publicarla:

- Defina `APP_USERNAME` y `APP_PASSWORD` en `.env`, o
- Proteja el dominio con **Cloudflare Access** (Zero Trust -> Access ->
  Applications). El plan gratuito permite hasta 50 usuarios.

No publique directamente el archivo de base de datos ni el puerto de un motor
SQL. Con SQLite no hay puerto que exponer: la base vive en el disco del servidor.

## 9. Volver a Google Sheets (plan de retorno)

Si algo falla, cambie en `.env`:

```text
DATA_BACKEND=sheets
```

Reinicie la aplicacion. Los datos nuevos registrados en SQLite no se copian
automaticamente a Sheets; para eso habria que escribir un script inverso.
