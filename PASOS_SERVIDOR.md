# Pasos en el servidor Windows (via TeamViewer)

> Esta guia corresponde al modo **todo en el servidor** (la app y la base viven
> en Windows y el tunel publica la app completa en el puerto 3000).
>
> Si quiere la pagina en **Vercel** y solo la base en el servidor, use
> `ARQUITECTURA_VERCEL.md` (la API se publica en el puerto 3001).

Esta guia asume que la base ya fue migrada en el equipo de desarrollo y que el
archivo `data\asistencias.db` viaja dentro del paquete `asistencias-servidor.zip`.

## Antes de empezar

- El servidor debe tener Windows con escritorio (TeamViewer funciona).
- Debe tener permisos de administrador.
- Debe tener Internet.
- Para el tunel necesita un dominio agregado a Cloudflare (plan gratuito).
  Si aun no lo tiene, puede hacer una prueba rapida con `trycloudflare.com`.
- No instale el proyecto en el Escritorio ni en OneDrive. Use `C:\asistencias`.

---

## 1. Copiar el paquete al servidor

1. En este equipo, localice `asistencias-servidor.zip` (esta en el Escritorio).
2. Abra TeamViewer -> **Transferencia de archivos**.
3. Copie el ZIP al servidor, por ejemplo a `C:\Users\Administrador\Downloads`.
4. En el servidor, clic derecho -> **Extraer todo**.
5. Mueva la carpeta extraida a `C:\asistencias`.

Debe quedar asi:

```text
C:\asistencias\package.json
C:\asistencias\src\server.js
C:\asistencias\data\asistencias.db
...
```

Verifique que existe:

```cmd
dir C:\asistencias\data\asistencias.db
```

---

## 2. Instalar Node.js

### Opcion A: winget

Abra **CMD como administrador**:

```cmd
winget install OpenJS.NodeJS.LTS
```

### Opcion B: instalador

Descargue Node.js LTS (24.x) de <https://nodejs.org/en/download> e instale con
las opciones por defecto.

Cierre y vuelva a abrir CMD. Verifique:

```cmd
node -v
npm -v
```

Debe mostrar `v22.5.0` o superior (ideal `v24.x`).

---

## 3. Instalar dependencias

```cmd
cd /d C:\asistencias
npm install
```

Debe crear la carpeta `node_modules`.

---

## 4. Crear el archivo .env

```cmd
cd /d C:\asistencias
notepad .env
```

Pegue exactamente esto (cambie la clave):

```text
DATA_BACKEND=sqlite
DATABASE_FILE=./data/asistencias.db
APP_TIME_ZONE=America/Guayaquil
APP_USERNAME=admin
APP_PASSWORD=CambieEstaClave2026
```

Guarde y cierre el Bloc de notas.

Notas:

- No necesita credenciales de Google en el servidor: la base ya viene migrada.
- `APP_USERNAME` y `APP_PASSWORD` activan la autenticacion basica. Si los deja
  vacios, cualquiera con la URL entra al sistema.

---

## 5. Probar la aplicacion

```cmd
cd /d C:\asistencias
npm start
```

Debe mostrar:

```text
Sistema de asistencia disponible en http://localhost:3000
```

En el servidor abra un navegador:

```text
http://localhost:3000
```

Pida usuario y clave, y verifique que aparecen los 59 trabajadores.
Para detener la prueba presione `Ctrl+C`.

Si aparece un error, revise que exista `C:\asistencias\data\asistencias.db`.

---

## 6. Dejar la aplicacion siempre encendida

### 6.1 Crear el lanzador

```cmd
notepad C:\asistencias\iniciar-asistencias.bat
```

Pegue:

```bat
@echo off
cd /d C:\asistencias
"C:\Program Files\nodejs\node.exe" --experimental-sqlite --disable-warning=ExperimentalWarning src\server.js >> C:\asistencias\app.log 2>&1
```

Guarde y cierre.

> Si Node quedo en otra ruta, ejecute `where node` y ajuste la ruta del `.bat`.

### 6.2 Registrar la tarea de inicio

En **CMD como administrador**:

```cmd
schtasks /Create /TN "Asistencias Punto PAS" /TR "C:\asistencias\iniciar-asistencias.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "Asistencias Punto PAS"
```

Comandos utiles:

```cmd
schtasks /Query /TN "Asistencias Punto PAS"
schtasks /End /TN "Asistencias Punto PAS"
schtasks /Run /TN "Asistencias Punto PAS"
type C:\asistencias\app.log
```

Compruebe otra vez `http://localhost:3000`.

---

## 7. Instalar Cloudflare Tunnel

### 7.1 Instalar cloudflared

```cmd
winget install --id Cloudflare.cloudflared
```

O descargue el `.exe` desde:
<https://github.com/cloudflare/cloudflared/releases/latest>

Copielo a una ruta fija:

```cmd
mkdir C:\Cloudflared\bin
```

Si instalo con winget, busque el ejecutable:

```cmd
where cloudflared
```

Copielo:

```cmd
copy "RUTA_QUE_MOSTRO_WHERE\cloudflared.exe" C:\Cloudflared\bin\cloudflared.exe
```

### 7.2 Autenticarse

```cmd
cd /d C:\Cloudflared\bin
cloudflared.exe tunnel login
```

Se abrira el navegador. Inicie sesion en Cloudflare, seleccione su dominio y
autorice.

### 7.3 Crear el tunel

```cmd
cloudflared.exe tunnel create asistencias
cloudflared.exe tunnel list
```

Anote el **Tunnel ID** (un texto largo) y confirme que se creo un archivo
`<TUNNEL-ID>.json` en:

```text
C:\Users\Administrador\.cloudflared\
```

### 7.4 Crear el DNS

Reemplace `sudominio.com` por su dominio real:

```cmd
cloudflared.exe tunnel route dns asistencias asistencias.sudominio.com
```

### 7.5 Crear config.yml de prueba

```cmd
notepad C:\Users\Administrador\.cloudflared\config.yml
```

Pegue (reemplace `<TUNNEL-ID>` y el dominio):

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\Administrador\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: asistencias.sudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

Valide:

```cmd
cloudflared.exe tunnel ingress validate
```

### 7.6 Probar el tunel

Con la aplicacion corriendo:

```cmd
cloudflared.exe tunnel run asistencias
```

Abra en el navegador:

```text
https://asistencias.sudominio.com
```

Si funciona, detenga con `Ctrl+C`.

### Prueba rapida sin dominio (opcional)

Si aun no tiene dominio en Cloudflare, puede probar temporalmente:

```cmd
cloudflared.exe tunnel --url http://localhost:3000
```

Le dara una URL `https://algo.trycloudflare.com`. Es solo para probar: cambia
cada vez que se reinicia y no sirve para produccion.

---

## 8. Instalar el tunel como servicio de Windows

Abra **CMD como administrador**.

### 8.1 Instalar el servicio

```cmd
cd /d C:\Cloudflared\bin
cloudflared.exe service install
```

### 8.2 Crear carpeta del perfil SYSTEM

Use `cmd`, no PowerShell, para que el punto de `.cloudflared` se respete:

```cmd
mkdir C:\Windows\System32\config\systemprofile\.cloudflared
```

### 8.3 Copiar archivos

```cmd
copy C:\Users\Administrador\.cloudflared\cert.pem C:\Windows\System32\config\systemprofile\.cloudflared\cert.pem
copy C:\Users\Administrador\.cloudflared\<TUNNEL-ID>.json C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL-ID>.json
copy C:\Users\Administrador\.cloudflared\config.yml C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
```

### 8.4 Ajustar el config para el servicio

Edite:

```cmd
notepad C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
```

Asegure que `credentials-file` apunte a la ruta del SYSTEM:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: asistencias.sudominio.com
    service: http://localhost:3000
  - service: http_status:404

logfile: C:\Cloudflared\cloudflared.log
```

### 8.5 Corregir el comando de inicio del servicio

El servicio por defecto a veces no ejecuta `tunnel run`. Corrija el Registro:

```cmd
reg add "HKLM\SYSTEM\CurrentControlSet\Services\cloudflared" /v ImagePath /t REG_EXPAND_SZ /d "\"C:\Cloudflared\bin\cloudflared.exe\" --config=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run" /f
```

### 8.6 Iniciar el servicio

```cmd
sc start cloudflared
sc query cloudflared
```

Debe indicar `RUNNING`. Pruebe de nuevo:

```text
https://asistencias.sudominio.com
```

---

## 9. Verificacion final

1. Reinicie el servidor.
2. Espere 1 o 2 minutos.
3. Abra `https://asistencias.sudominio.com`.
4. Verifique que pide usuario y clave.
5. Registre una asistencia de prueba y confirmela en el historial.

Si algo falla, revise:

```cmd
type C:\asistencias\app.log
type C:\Cloudflared\cloudflared.log
sc query cloudflared
schtasks /Query /TN "Asistencias Punto PAS"
netstat -ano | findstr :3000
```

---

## 10. Respaldos

Manual:

```cmd
cd /d C:\asistencias
npm run backup
```

Los respaldos quedan en `C:\asistencias\data\backups\`.

Para respaldo diario automatico, cree otra tarea:

```cmd
schtasks /Create /TN "Respaldo Asistencias" /TR "cmd /c cd /d C:\asistencias && npm run backup" /SC DAILY /ST 23:00 /RU SYSTEM /RL HIGHEST /F
```

Copie periodicamente `C:\asistencias\data\backups` a otro disco o a la nube.
No sincronice la carpeta activa `C:\asistencias\data`.

---

## 11. Seguridad recomendada

- Mantenga `APP_USERNAME` y `APP_PASSWORD` definidos.
- Mejor aun: cree una aplicacion en **Cloudflare Zero Trust -> Access ->
  Applications** para `asistencias.sudominio.com`. El plan gratuito permite
  hasta 50 usuarios y agrega login con correo, codigo o Google.
- No comparta el dominio publicamente sin proteccion.

---

## 12. Problemas comunes

| Sintoma | Causa probable | Solucion |
|---|---|---|
| `node` no se reconoce | Node no instalado o CMD viejo | Reinstalar Node y abrir CMD nuevo |
| `npm install` falla | Sin Internet o proxy | Verificar red del servidor |
| Error 502 en el dominio | La app no esta corriendo | `schtasks /Run /TN "Asistencias Punto PAS"` |
| La app no abre en localhost | Puerto ocupado | `netstat -ano | findstr :3000` |
| El tunel no conecta | Config o credenciales mal ubicadas | Revisar `cloudflared.log` |
| Pide login y no acepta | `.env` distinto | Reiniciar la tarea despues de editar `.env` |
| Pagina sin estilos | Falta `public/` | Revisar que el ZIP se extrajo completo |

Cada cambio en `.env` requiere reiniciar la app:

```cmd
schtasks /End /TN "Asistencias Punto PAS"
schtasks /Run /TN "Asistencias Punto PAS"
```

Cada cambio en `config.yml` requiere reiniciar el tunel:

```cmd
sc stop cloudflared
sc start cloudflared
```
