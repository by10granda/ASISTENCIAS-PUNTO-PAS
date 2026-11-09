# Arquitectura: pagina en Vercel + base de datos en el servidor

Esta es la configuracion que permite:

- La **pagina** se despliega en **Vercel** desde GitHub.
- La **base de datos SQLite** vive en el **servidor Windows**.
- Los datos viajan por **Cloudflare Tunnel** en HTTPS/JSON.
- No se expone la base de datos directamente a Internet.

## Estado actual (desplegado)

| Elemento | Valor |
|---|---|
| Pagina publica | `https://asistencias-punto-pas.vercel.app` |
| Usuario / clave | `admin` / `admin` |
| Proyecto Vercel | `punto-pas/asistencias-punto-pas` |
| Repositorio | GitHub `by10granda/ASISTENCIAS-PUNTO-PAS`, rama `main` |
| API del servidor | `https://continually-staying-commissioners-terrorism.trycloudflare.com` |
| Base de datos | `C:\asistencias\data\asistencias.db` |

> La URL de la API es un **tunel rapido** de Cloudflare: cambia si se cierra o
> reinicia la ventana de `cloudflared`. Cuando cambie, actualice `STORE_API_URL`
> en Vercel (Settings -> Environment Variables) y vuelva a desplegar.

### Como desplegar

El proyecto esta conectado a GitHub: **cada `git push` a `main` despliega solo**
en produccion. No hace falta ejecutar comandos ni abrir el panel.

```bash
git push origin main
```

## Como funciona

```text
Navegador
   |
   v
Vercel (pagina EJS + git)
   |  HTTPS  Authorization: Bearer <token>
   v
https://api.sudominio.com
   |
   v
Cloudflare Tunnel (cloudflared en el servidor)
   |
   v
API Express en http://127.0.0.1:3001
   |
   v
data/asistencias.db (SQLite)
```

- Vercel ejecuta la app completa (`src/server.js`) en modo `DATA_BACKEND=remote`.
- `src/remoteStore.js` no toca SQLite: llama a `POST /api/store/<metodo>`.
- El servidor ejecuta `src/apiServer.js`, que si usa `dbStore.js` y SQLite.
- La API exige un token (`STORE_API_TOKEN`) en cada peticion.

## Requisitos

- El servidor debe estar encendido y con Internet para que la pagina funcione.
- Node.js 22.5+ en el servidor.
- Proyecto en `C:\asistencias` con `data\asistencias.db`.
- Cloudflare Tunnel configurado (nuevo o reutilizado).
- Proyecto enlazado a Vercel (ya lo esta).

---

## 1. Configurar el servidor

Edite `C:\asistencias\.env`:

```text
DATA_BACKEND=sqlite
DATABASE_FILE=./data/asistencias.db
APP_TIME_ZONE=America/Guayaquil

STORE_API_PORT=3001
STORE_API_HOST=127.0.0.1
STORE_API_TOKEN=<TOKEN_GENERADO>
```

> Use un token largo y unico. El mismo valor debe ir en Vercel. Si lo cambia,
> cambielo en los dos lugares.

Prueba manual de la API:

```cmd
cd /d C:\asistencias
npm run api
```

Debe mostrar:

```text
API de datos disponible en http://127.0.0.1:3001
```

En otra ventana:

```cmd
curl http://127.0.0.1:3001/health
```

Respuesta esperada:

```json
{"ok":true,"service":"asistencias-store-api"}
```

Detenga con `Ctrl+C`.

---

## 2. Ejecutar la API como tarea de Windows

Cree el lanzador:

```cmd
notepad C:\asistencias\iniciar-api.bat
```

Contenido:

```bat
@echo off
cd /d C:\asistencias
"C:\Program Files\nodejs\node.exe" --experimental-sqlite --disable-warning=ExperimentalWarning src\apiServer.js >> C:\asistencias\api.log 2>&1
```

Registre la tarea (CMD como administrador):

```cmd
schtasks /Create /TN "Asistencias API" /TR "C:\asistencias\iniciar-api.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "Asistencias API"
```

Verifique:

```cmd
netstat -ano | findstr :3001
type C:\asistencias\api.log
```

Si antes tenia la tarea `Asistencias Punto PAS` corriendo la app completa en el
puerto 3000, puede detenerla y eliminarla para no duplicar procesos:

```cmd
schtasks /End /TN "Asistencias Punto PAS"
schtasks /Delete /TN "Asistencias Punto PAS" /F
```

---

## 3. Publicar la API con Cloudflare Tunnel

La API debe quedar en un subdominio, por ejemplo:

```text
https://api.sudominio.com  ->  http://localhost:3001
```

### Opcion A: reutilizar el tunel existente

Solo si el tunel corre en este mismo servidor. Edite su `config.yml` y agregue
la regla **antes** de la regla final `http_status:404`:

```yaml
ingress:
  - hostname: api.sudominio.com
    service: http://localhost:3001
  # ... sus reglas actuales ...
  - service: http_status:404
```

Cree el DNS:

```cmd
cloudflared tunnel route dns <NOMBRE-O-ID-DEL-TUNEL> api.sudominio.com
```

Reinicie el servicio:

```cmd
sc.exe stop cloudflared
sc.exe start cloudflared
```

### Opcion B: crear un tunel nuevo

```cmd
cd /d C:\Cloudflared\bin
cloudflared.exe tunnel create asistencias-api
cloudflared.exe tunnel list
cloudflared.exe tunnel route dns asistencias-api api.sudominio.com
```

Cree `C:\Users\Administrador\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\Administrador\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: api.sudominio.com
    service: http://localhost:3001
  - service: http_status:404
```

Prueba manual:

```cmd
cloudflared.exe tunnel run asistencias-api
```

Si funciona, `Ctrl+C` y configure el servicio. Recuerde copiar `cert.pem`,
`<TUNNEL-ID>.json` y `config.yml` a:

```text
C:\Windows\System32\config\systemprofile\.cloudflared\
```

y ajustar el `ImagePath` del servicio `cloudflared` para que apunte a ese
`config.yml`. Luego:

```cmd
sc.exe stop cloudflared
sc.exe start cloudflared
```

### Verificar desde fuera

```powershell
Invoke-RestMethod -Uri "https://api.sudominio.com/health"
```

Debe devolver `ok: True`.

Prueba autenticada:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://api.sudominio.com/api/store/listWorkers" `
  -Headers @{ Authorization = "Bearer <TOKEN_GENERADO>" } `
  -ContentType "application/json" `
  -Body '{"args":[]}'
```

Debe devolver la lista de trabajadores.

---

## 4. Configurar Vercel

En Vercel -> proyecto `asistencias-punto-pas` -> Settings -> Environment Variables,
agregue (para Production, Preview y Development):

```text
DATA_BACKEND=remote
STORE_API_URL=https://api.sudominio.com
STORE_API_TOKEN=<TOKEN_GENERADO>
APP_TIME_ZONE=America/Guayaquil
APP_USERNAME=admin
APP_PASSWORD=UnaClaveLargaYSegura
```

Notas:

- `STORE_API_URL` sin barra final.
- `STORE_API_TOKEN` debe ser identico al del servidor.
- `APP_USERNAME`/`APP_PASSWORD` protegen la pagina publica.
- No suba el archivo `.env` a GitHub.

El `vercel.json` ya incluye `src/**` en el bundle de la funcion, para que
`remoteStore.js` este disponible aunque se cargue de forma dinamica.

## 5. Desplegar

Desde este equipo:

```bash
git add .
git commit -m "Add remote store for Vercel + server SQLite"
git push
```

Vercel desplegara automaticamente. Tambien puede forzar:

```bash
vercel --prod
```

Abra la URL de Vercel y pruebe:

1. Inicio de sesion basico.
2. Panel principal con los 59 trabajadores.
3. Registro de una asistencia.
4. Historial y reportes PDF/Excel.

---

## 6. Seguridad

- La API solo acepta peticiones con el token correcto.
- La API solo expone las funciones de la lista blanca; no ejecuta SQL libre.
- Cloudflare aporta HTTPS.
- Opcionalmente, proteja `api.sudominio.com` con **Cloudflare Access** usando un
  **Service Token** para Vercel (Zero Trust -> Access -> Service Auth). En ese
  caso, agregue los headers `CF-Access-Client-Id` y
  `CF-Access-Client-Secret` en `remoteStore.js` o desactive Access para esa ruta.
- Rote el token si alguna vez se filtra: cambie `STORE_API_TOKEN` en el servidor
  y en Vercel, y reinicie la API.

## 7. Limitaciones reales de esta arquitectura

- Si el servidor esta apagado o sin Internet, la pagina de Vercel no puede leer
  ni guardar datos.
- Cada pantalla hace varias llamadas HTTP al servidor. Con 35 trabajadores es
  rapido, pero depende de la velocidad de subida del servidor.
- Vercel Hobby limita la ejecucion de funciones (10 s por defecto). Los reportes
  actuales estan muy por debajo, pero si crece mucho habria que optimizar.
- Los PDF y Excel se generan en Vercel a partir de los datos recibidos.
- SQLite permite un escritor a la vez. Para este volumen no es un problema.
- No hay acceso directo a la base desde Vercel: todo pasa por la API.

## 8. Diagnostico

| Sintoma | Causa probable | Solucion |
|---|---|---|
| 502 en api.sudominio.com | La API no esta corriendo | `schtasks /Run /TN "Asistencias API"` |
| 401 NO_AUTORIZADO | Token distinto | Igualar `STORE_API_TOKEN` en servidor y Vercel |
| 503 API_SIN_TOKEN_CONFIGURADO | Falta el token en el servidor | Editar `.env` y reiniciar la tarea |
| Timeout en Vercel | Servidor lento o caido | Revisar `api.log` y conexion |
| La pagina carga sin datos | `DATA_BACKEND` mal en Vercel | Debe ser `remote` |
| Cambios en `.env` sin efecto | No se reinicio la tarea | `schtasks /End` + `schtasks /Run` |

Logs:

```cmd
type C:\asistencias\api.log
type C:\Cloudflared\cloudflared.log
```

## 9. Volver al modo todo-en-servidor

Si algun dia quiere dejar Vercel de lado:

1. En el servidor, detenga la tarea de la API.
2. Cree una tarea que ejecute `src\server.js` en el puerto 3000.
3. Apunte el tunel a `http://localhost:3000`.
4. Use `DATA_BACKEND=sqlite` en el servidor.

La guia de ese modo esta en `PASOS_SERVIDOR.md`.
