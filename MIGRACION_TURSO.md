# Migracion a Turso (base de datos en la nube)

La app puede funcionar sin el servidor Windows: la base SQLite pasa a **Turso**
(libSQL en la nube) y Vercel se conecta directamente por HTTPS.

## Estado actual de la migracion

Ya se copiaron los datos reales desde la API del servidor a Turso:

| Tabla | Registros |
| --- | --- |
| Trabajadores | 67 |
| Sucursales | 1 |
| Asistencia | 289 |
| Vacaciones | 15 |
| Llamados de atencion | 30 |
| Retiros por salud | 2 |
| Certificados | 2 |

> Nota sobre certificados: 50 registros estaban marcados como "con documento"
> pero el servidor ya no tenia el archivo fisico. Se conserva el registro; solo
> esos archivos antiguos no se pueden recuperar. Los certificados nuevos se
> guardan dentro de Turso (columna `data_base64`), sin depender de archivos.

## Como funciona

- `DATA_BACKEND=turso` selecciona `src/tursoStore.js`.
- `src/tursoStore.js` usa `@libsql/client/web` (HTTPS, sin binarios nativos).
- `src/dbStore.js` sigue existiendo para uso local y como respaldo.
- Los certificados se guardan como texto base64 en la tabla `certificates`.

## Activar Turso en Vercel

1. Vercel -> proyecto -> **Settings -> Environment Variables**.
2. Agregar (entorno Production y Preview):

```
DATA_BACKEND=turso
TURSO_DATABASE_URL=libsql://asistencias-distribuidorpuntopas.aws-sa-east-1.turso.io
TURSO_AUTH_TOKEN=<el token creado en Turso>
```

3. Guardar y hacer **Redeploy** del ultimo deployment (Deployments -> ... -> Redeploy).
4. Probar: login, Panel, Asistencia, editar, eliminar, Reportes e Historial.

Mientras `DATA_BACKEND=remote` siga configurado, la app continua usando el
servidor Windows sin cambios.

## Volver al servidor Windows (rollback)

Si algo falla, cambie en Vercel:

```
DATA_BACKEND=remote
```

y haga Redeploy. El servidor debe estar encendido. No se pierde nada: Turso
conserva la copia y el servidor conserva la suya.

## Volver a copiar datos a Turso

Si el servidor Windows sigue recibiendo registros y luego quiere sincronizar de
nuevo hacia Turso, ejecute desde este equipo:

```powershell
$env:TURSO_DATABASE_URL = "libsql://asistencias-distribuidorpuntopas.aws-sa-east-1.turso.io"
$env:TURSO_AUTH_TOKEN   = "<token>"
$env:SOURCE             = "remote"
$env:SOURCE_API_URL     = "https://asistencias-pas.tail6b95f3.ts.net"
$env:SOURCE_API_TOKEN   = "<token de STORE_API>"
node scripts/migrate-to-turso.mjs
```

El script **reemplaza** el contenido de Turso con el origen indicado.
Para copiar desde el archivo local:

```powershell
$env:SOURCE = "local"
$env:DATABASE_FILE = "./data/asistencias.db"
node scripts/migrate-to-turso.mjs
```

## Despues de activar Turso

Cuando todo funcione durante unos dias:

1. Detener la tarea `Asistencias API` en el servidor Windows.
2. Desactivar Tailscale Funnel.
3. El servidor puede apagarse: la web ya no depende de el.

## Respaldos

- Turso guarda la base en la nube, pero conviene un respaldo semanal.
- Con la app en Turso, exporte desde Reportes a Excel/PDF, o pida un `dump` con
  la CLI de Turso.
- El archivo `data/asistencias.db` del servidor queda como respaldo historico.

## Seguridad

- El token de Turso solo debe vivir en las variables de Vercel. **No** se sube a
  GitHub.
- Si se filtra, cree un token nuevo en Turso y actualice Vercel.
