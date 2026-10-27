# Manual de Usuario

## Acceso al sistema

Ingrese desde el navegador a:

```text
https://asistencias-punto-pas.vercel.app
```

El sistema muestra un menu lateral con estas opciones:

- Panel
- Trabajadores
- Asistencia
- Vacaciones
- Historial
- Reportes

## 1. Panel principal

La pantalla inicial muestra un resumen rapido del dia:

- Total de trabajadores activos.
- Presentes hoy.
- Faltas justificadas hoy.
- Faltas injustificadas hoy.
- Atrasos hoy.
- Trabajadores de vacaciones.
- Trabajadores con permiso.

Tambien muestra un resumen mensual agrupado por tipo de novedad.

## 2. Gestion de trabajadores

### Registrar trabajador

1. Ingrese a `Trabajadores`.
2. Presione `Registrar trabajador`.
3. Complete los datos:
   - Nombres y apellidos.
   - Cedula.
   - Cargo.
   - Sucursal o area.
   - Fecha de ingreso.
   - Estado.
4. Presione `Guardar`.
5. Confirme la accion cuando el sistema lo solicite.

### Editar trabajador

1. Ingrese a `Trabajadores`.
2. Busque el trabajador en la tabla.
3. Presione `Editar`.
4. Modifique los datos necesarios.
5. Presione `Guardar`.
6. Confirme la accion.

### Seleccionar o agregar sucursal

Al registrar o editar un trabajador, seleccione su sucursal o area de la lista. Las opciones se obtienen de los trabajadores actuales y de las sucursales agregadas al catalogo.

Si necesita una nueva, use el formulario `Anadir sucursal o area`, ingrese el nombre y presione `Agregar sucursal`. Agreguela antes de completar los datos del trabajador, porque la pagina se recarga. No se permiten nombres duplicados, aunque cambien las mayusculas.

### Activar o desactivar trabajador

1. Ingrese a `Trabajadores`.
2. Presione `Editar` en el trabajador correspondiente.
3. Cambie el campo `Estado` a `Activo` o `Inactivo`.
4. Presione `Guardar`.

Los trabajadores inactivos quedan en el historial, pero no aparecen como disponibles para registrar asistencia diaria.

### Buscar trabajadores

1. Ingrese a `Trabajadores`.
2. Use el campo de busqueda.
3. Puede buscar por nombre, cedula, cargo, sucursal o area.
4. Presione `Buscar`.

## 3. Registro de asistencia

### Registrar asistencia diaria

1. Ingrese a `Asistencia`.
2. Seleccione la fecha del registro.
3. Presione `Cambiar fecha` si necesita registrar otro dia.
4. Seleccione el trabajador.
5. Seleccione el estado:
   - `ASISTENCIA NORMAL`
   - `FALTA JUSTIFICADA`
   - `FALTA INJUSTIFICADA`
   - `ATRASO`
   - `VACACIONES`
   - `PERMISO`
6. Complete los campos que aparecen segun el estado seleccionado.
7. Ingrese el usuario que registra.
8. Agregue una observacion si corresponde.
9. Presione `Guardar asistencia`.
10. Confirme la accion.

### Evitar registros duplicados

El sistema no crea dos asistencias para el mismo trabajador en la misma fecha.

Si registra nuevamente la asistencia del mismo trabajador y fecha, el sistema actualiza el registro existente.

## 4. Tipos de asistencia y novedades

### Asistencia normal

Use esta opcion cuando el trabajador asistio normalmente.

Debe ingresar:

- Hora de entrada.
- Observacion, si aplica.

### Falta justificada

Use esta opcion cuando el trabajador falto con una justificacion valida.

Debe ingresar:

- Motivo.
- Observacion, si aplica.
- Indicar si existe documento de respaldo.

### Falta injustificada

Use esta opcion cuando el trabajador no asistio y no presento justificacion.

Debe ingresar:

- Observacion, si aplica.

El acumulado de faltas injustificadas se puede revisar desde `Reportes` o `Historial`.

### Atraso

Use esta opcion cuando el trabajador llego despues de la hora establecida.

Debe ingresar:

- Hora establecida de entrada.
- Hora real de llegada.
- Observacion, si aplica.

El sistema calcula automaticamente los minutos de atraso.

### Vacaciones

Use esta opcion en asistencia si quiere marcar un dia puntual como vacaciones.

Para registrar periodos completos de vacaciones, use el modulo `Vacaciones`.

### Permiso

Use esta opcion cuando el trabajador tiene permiso por horas o por dia completo.

Debe ingresar:

- Si corresponde a dia completo.
- Hora de salida, si aplica.
- Hora de regreso, si aplica.
- Motivo del permiso.
- Observacion, si aplica.

## 5. Vacaciones

### Registrar vacaciones

1. Ingrese a `Vacaciones`.
2. Seleccione el trabajador.
3. Ingrese la fecha de inicio.
4. Ingrese la fecha de finalizacion.
5. Seleccione el estado:
   - `Programadas`
   - `En curso`
   - `Finalizadas`
6. Agregue una observacion si corresponde.
7. Presione `Guardar vacaciones`.
8. Confirme la accion.

El sistema calcula automaticamente el numero total de dias.

### Saldo de vacaciones

El sistema genera 15 dias calendario por cada ano cumplido desde la fecha de ingreso. Del total generado descuenta las vacaciones `Programadas`, `En curso` y `Finalizadas`.

Los dias no utilizados se acumulan. La tabla de saldos muestra los dias generados, utilizados, dados de baja y disponibles de cada trabajador.

### Dar de baja dias acumulados

1. Seleccione el trabajador.
2. Ingrese la cantidad de dias.
3. Indique la fecha, el motivo y el responsable.
4. Presione `Registrar baja` y confirme la accion.

La baja queda guardada en el historial y no puede superar el saldo disponible.

## 6. Historial

La pantalla `Historial` permite consultar todos los registros de asistencia y novedades.

Puede filtrar por:

- Trabajador.
- Fecha exacta.
- Desde.
- Hasta.
- Mes.
- Sucursal.
- Tipo de novedad.

### Consultar historial

1. Ingrese a `Historial`.
2. Complete uno o varios filtros.
3. Presione `Filtrar`.
4. Para quitar filtros, presione `Limpiar`.

## 7. Reportes

La pantalla `Reportes` permite generar reportes mensuales.

### Reporte general

1. Ingrese a `Reportes`.
2. Seleccione las fechas desde y hasta.
3. Deje el campo trabajador en `Reporte general`.
4. Presione `Generar reporte`.

El reporte muestra todos los trabajadores con sus totales del mes.

### Reporte por trabajador

1. Ingrese a `Reportes`.
2. Seleccione las fechas desde y hasta.
3. Seleccione un trabajador.
4. Presione `Generar reporte`.

El reporte muestra:

- Faltas justificadas.
- Faltas injustificadas.
- Cantidad de atrasos.
- Minutos totales de atraso.
- Dias de vacaciones.
- Permisos.

## 8. Recomendaciones de uso

- Registrar atrasos, faltas, vacaciones o permisos cuando exista una novedad.
- Revisar bien la fecha antes de guardar.
- Mantener actualizada la lista de trabajadores activos e inactivos.
- Usar observaciones claras cuando exista una novedad.
- Registrar vacaciones por periodo desde el modulo `Vacaciones`.
- Usar `Historial` para verificar registros anteriores antes de corregir informacion.

## 9. Solucion de problemas comunes

### No aparece un trabajador al registrar asistencia

Revise si el trabajador esta marcado como `Inactivo`. Solo los trabajadores activos aparecen en el registro diario.

### Se guardo mal una asistencia

Ingrese nuevamente a `Asistencia`, seleccione la misma fecha y el mismo trabajador, corrija los datos y guarde. El sistema actualizara el registro existente.

### El sistema pide confirmar antes de guardar

Es normal. La confirmacion evita modificaciones accidentales.

### No se ven datos en reportes

Verifique que haya registros de asistencia en el mes seleccionado.

### No se ven datos en historial

Revise los filtros aplicados. Puede presionar `Limpiar` para ver todos los registros.
