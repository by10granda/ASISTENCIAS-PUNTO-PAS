// Carga y vista previa del reporte Excel del biometrico (sucursal VARIEDADES PAS).
// El archivo se interpreta en el servidor y aqui solo se muestra y edita.
(() => {
  const modal = document.querySelector('#biometricModal');
  if (!modal) return;

  const openButton = document.querySelector('#biometricOpen');
  const fileInput = document.querySelector('#biometricFile');
  const closeButton = document.querySelector('#biometricClose');
  const cancelButton = document.querySelector('#biometricCancel');
  const saveButton = document.querySelector('#biometricSave');
  const loading = document.querySelector('#biometricLoading');
  const errorBox = document.querySelector('#biometricError');
  const body = document.querySelector('#biometricBody');
  const rangeLabel = document.querySelector('#biometricRange');
  const summary = document.querySelector('#biometricSummary');
  const matchInfo = document.querySelector('#biometricMatchInfo');
  const dayInfo = document.querySelector('#biometricDayInfo');
  const mapBody = document.querySelector('#biometricMapBody');
  const dayBody = document.querySelector('#biometricDayBody');
  const onlyMapped = document.querySelector('#biometricOnlyMapped');
  const search = document.querySelector('#biometricSearch');
  const statusLabel = document.querySelector('#biometricStatus');

  const branch = modal.dataset.branch || 'VARIEDADES PAS';
  const matchLabels = { exact: 'Coincide', probable: 'Probable', ambiguous: 'Ambigüo', none: 'No encontrado' };
  const statusOptions = [
    ['ASISTENCIA NORMAL', 'Asistencia normal'],
    ['ATRASO', 'Atraso'],
    ['DIA LIBRE', 'Día libre']
  ];

  let state = emptyState();
  let saving = false;

  function emptyState() {
    return {
      data: null,
      workers: [],
      mapping: new Map(),
      days: [],
      candidatesById: new Map(),
      onlyMapped: true,
      query: ''
    };
  }

  openButton?.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      alert('Seleccione un archivo Excel (.xlsx) del biométrico.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert('El archivo supera los 3 MB que acepta el servidor. Exporte el reporte en un rango de fechas más corto o divídalo en partes.');
      return;
    }

    openModal();
    showLoading('Leyendo el archivo del biométrico...');
    try {
      const fileData = await fileToBase64(file);
      const response = await fetch('/asistencia/biometrico/analizar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch, file_name: file.name, file_data: fileData })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          throw new Error('La sesión expiró. Recargue la página e inicie sesión nuevamente.');
        }
        if (response.status === 413) {
          throw new Error('El archivo es demasiado grande para el servidor. Exporte un rango de fechas más corto o divídalo en partes.');
        }
        if (payload.detail) console.warn('Detalle del servidor:', payload.detail);
        throw new Error(payload.error || `El servidor respondió con error ${response.status}. Intente de nuevo.`);
      }
      prepare(payload);
    } catch (error) {
      showError(error.message);
    }
  });

  closeButton?.addEventListener('click', closeModal);
  cancelButton?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal && !saving) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden && !saving) closeModal();
  });

  onlyMapped?.addEventListener('change', () => {
    state.onlyMapped = onlyMapped.checked;
    applyFilters();
  });
  search?.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    applyFilters();
  });

  saveButton?.addEventListener('click', saveRows);

  /* ------------------------------------------------------------------ */
  /* Vista previa                                                        */
  /* ------------------------------------------------------------------ */

  function prepare(payload) {
    state = emptyState();
    state.data = payload;
    state.candidatesById = new Map(payload.candidates.map((candidate) => [String(candidate.id), candidate]));
    state.workers = payload.workers;
    state.days = [];
    const assigned = new Set();
    payload.workers.forEach((worker, workerIndex) => {
      let workerId = worker.worker_id ? String(worker.worker_id) : '';
      // Si dos nombres del Excel apuntan al mismo trabajador, solo se asigna
      // el primero; el segundo queda para que el usuario lo revise.
      if (workerId && assigned.has(workerId)) {
        worker.match = 'ambiguous';
        worker.worker_id = null;
        workerId = '';
      }
      if (workerId) {
        state.mapping.set(workerIndex, workerId);
        assigned.add(workerId);
      }
      worker.days.forEach((day) => {
        state.days.push({
          workerIndex,
          date: day.date,
          status: 'ASISTENCIA NORMAL',
          entry_time: day.entry_time || '',
          lunch_out: day.lunch_out || '',
          lunch_in: day.lunch_in || '',
          exit_time: day.exit_time || '',
          observation: '',
          punch_count: day.punch_count || 0,
          removed: false
        });
      });
    });

    const totalDays = state.days.length;
    const dates = state.days.map((day) => day.date).sort();
    const firstDate = payload.range.start;
    const lastDate = dates[dates.length - 1] || payload.range.end;
    rangeLabel.textContent = `Del ${firstDate} al ${lastDate} · ${payload.file_name || 'reporte'} · ${totalDays} día(s) con marcas`;
    onlyMapped.checked = true;
    search.value = '';
    renderMapping();
    renderDays();
    updateSummary();
    showBody();
  }

  function renderMapping() {
    mapBody.replaceChildren();
    state.workers.forEach((worker, index) => {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'biometric-worker';
      nameCell.textContent = worker.excel_name;
      const dept = document.createElement('small');
      dept.textContent = worker.dept || '';
      if (worker.dept) nameCell.appendChild(dept);

      const idCell = document.createElement('td');
      idCell.textContent = worker.excel_id || '-';

      const matchCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `biometric-badge ${worker.match || 'none'}`;
      badge.textContent = matchLabels[worker.match] || worker.match || 'Sin datos';
      matchCell.appendChild(badge);

      const selectCell = document.createElement('td');
      const select = document.createElement('select');
      select.dataset.workerIndex = String(index);
      select.appendChild(new Option('— Sin asignar —', ''));
      state.data.candidates.forEach((candidate) => {
        const label = `${candidate.full_name} · ${candidate.cedula}${candidate.status && candidate.status !== 'Activo' ? ` · ${candidate.status}` : ''}`;
        select.appendChild(new Option(label, String(candidate.id)));
      });
      select.value = state.mapping.get(index) || '';
      select.addEventListener('change', () => {
        if (select.value) {
          const duplicate = [...state.mapping.entries()].find(([otherIndex, workerId]) => otherIndex !== index && workerId === select.value);
          if (duplicate) {
            alert('Ese trabajador ya esta asignado a otro nombre del Excel. Elija otro o libere el anterior.');
            select.value = state.mapping.get(index) || '';
            return;
          }
          state.mapping.set(index, select.value);
        } else {
          state.mapping.delete(index);
        }
        renderDays();
        updateSummary();
      });
      selectCell.appendChild(select);

      row.append(nameCell, idCell, matchCell, selectCell);
      mapBody.appendChild(row);
    });
  }

  function renderDays() {
    const fragment = document.createDocumentFragment();
    state.days.forEach((day, index) => {
      const row = document.createElement('tr');
      row.dataset.index = String(index);
      row.dataset.workerIndex = String(day.workerIndex);
      if (day.removed) row.classList.add('removed');

      const workerCell = document.createElement('td');
      workerCell.className = 'biometric-worker';
      const mapped = mappedWorker(day.workerIndex);
      const strong = document.createElement('strong');
      if (mapped) {
        strong.textContent = mapped.full_name;
        const small = document.createElement('small');
        small.textContent = mapped.cedula || '';
        workerCell.append(strong, small);
      } else {
        strong.textContent = 'Sin asignar';
        const small = document.createElement('small');
        small.textContent = state.workers[day.workerIndex]?.excel_name || '';
        workerCell.append(strong, small);
        row.classList.add('unmapped');
      }

      const dateCell = document.createElement('td');
      dateCell.textContent = day.date;

      const statusCell = document.createElement('td');
      const statusSelect = document.createElement('select');
      statusOptions.forEach(([value, label]) => statusSelect.appendChild(new Option(label, value)));
      statusSelect.value = day.status;
      statusSelect.addEventListener('change', () => {
        day.status = statusSelect.value;
        applyRowState(row, day);
        updateSummary();
      });
      statusCell.appendChild(statusSelect);

      const entryCell = timeCell(day, 'entry_time');
      const lunchOutCell = timeCell(day, 'lunch_out');
      const lunchInCell = timeCell(day, 'lunch_in');
      const exitCell = timeCell(day, 'exit_time');

      const observationCell = document.createElement('td');
      const observationInput = document.createElement('input');
      observationInput.type = 'text';
      observationInput.placeholder = 'Opcional';
      observationInput.value = day.observation || '';
      observationInput.addEventListener('input', () => {
        day.observation = observationInput.value;
      });
      observationCell.appendChild(observationInput);

      const lateCell = document.createElement('td');
      lateCell.className = 'biometric-late';

      const actionCell = document.createElement('td');
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'biometric-remove';
      removeButton.title = 'Quitar este día de la importación';
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        day.removed = !day.removed;
        row.classList.toggle('removed', day.removed);
        removeButton.title = day.removed ? 'Restaurar este día' : 'Quitar este día de la importación';
        removeButton.textContent = day.removed ? '↺' : '×';
        applyRowState(row, day);
        updateSummary();
        applyFilters();
      });
      actionCell.appendChild(removeButton);

      row.append(workerCell, dateCell, statusCell, entryCell, lunchOutCell, lunchInCell, exitCell, observationCell, lateCell, actionCell);
      applyRowState(row, day, lateCell);
      fragment.appendChild(row);
    });

    dayBody.replaceChildren(fragment);
    applyFilters();
  }

  function timeCell(day, field) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'time';
    input.value = day[field] || '';
    input.dataset.field = field;
    input.addEventListener('input', () => {
      day[field] = input.value;
      const row = input.closest('tr');
      const lateCell = row.querySelector('.biometric-late');
      updateLate(lateCell, day);
      updateSummary();
    });
    cell.appendChild(input);
    return cell;
  }

  function applyRowState(row, day, lateCell = null) {
    const free = day.status === 'DIA LIBRE';
    row.querySelectorAll('input[type="time"]').forEach((input) => {
      input.disabled = free || day.removed;
      input.style.opacity = free ? '.45' : '1';
    });
    row.querySelectorAll('select').forEach((select) => {
      select.disabled = day.removed;
    });
    updateLate(lateCell || row.querySelector('.biometric-late'), day);
  }

  function updateLate(cell, day) {
    if (!cell) return;
    let lateMinutes = 0;
    if (day.status === 'ASISTENCIA NORMAL' || day.status === 'ATRASO') {
      const entry = timeToMinutes(day.entry_time);
      if (entry !== null) lateMinutes += Math.max(entry - timeToMinutes('07:00'), 0);
      if (day.lunch_out && day.lunch_in) {
        const lunch = timeToMinutes(day.lunch_in) - timeToMinutes(day.lunch_out);
        if (lunch > 60) lateMinutes += lunch - 60;
      }
      const exit = timeToMinutes(day.exit_time);
      if (exit !== null) lateMinutes += Math.max(timeToMinutes('18:00') - exit, 0);
    }
    cell.textContent = lateMinutes > 0 ? `${lateMinutes} min` : '-';
  }

  function updateSummary() {
    const totalWorkers = state.workers.length;
    const mappedWorkers = state.workers.filter((_, index) => state.mapping.has(index)).length;
    const activeDays = state.days.filter((day) => !day.removed);
    const mappedDays = activeDays.filter((day) => state.mapping.has(day.workerIndex));
    const unmappedDays = activeDays.length - mappedDays.length;

    summary.replaceChildren(createChip(`${totalWorkers} trabajador(es) en el Excel`));
    summary.appendChild(createChip(`${activeDays.length} día(s) con marcas`, 'ok'));
    summary.appendChild(createChip(`${mappedWorkers} asignado(s)`, mappedWorkers ? 'ok' : 'warn'));
    if (unmappedDays) summary.appendChild(createChip(`${unmappedDays} día(s) sin asignar`, 'warn'));

    matchInfo.textContent = `${mappedWorkers} de ${totalWorkers} trabajadores asignados`;
    dayInfo.textContent = `${mappedDays.length} día(s) se guardarán${unmappedDays ? ` · ${unmappedDays} se omitirán` : ''}`;
    statusLabel.textContent = mappedDays.length
      ? `${mappedDays.length} día(s) listos para guardar${unmappedDays ? ` · ${unmappedDays} sin asignar` : ''}`
      : 'Asigna al menos un trabajador para poder guardar.';
    saveButton.disabled = saving || mappedDays.length === 0;
  }

  function createChip(text, tone = '') {
    const chip = document.createElement('span');
    chip.className = `biometric-chip${tone ? ` ${tone}` : ''}`;
    chip.textContent = text;
    return chip;
  }

  function mappedWorker(workerIndex) {
    return state.candidatesById.get(state.mapping.get(workerIndex)) || null;
  }

  function applyFilters() {
    if (!state.data) return;
    state.days.forEach((day, index) => {
      const row = dayBody.querySelector(`tr[data-index="${index}"]`);
      if (!row) return;
      const mapped = mappedWorker(day.workerIndex);
      const haystack = `${mapped?.full_name || ''} ${state.workers[day.workerIndex]?.excel_name || ''} ${day.date}`.toLowerCase();
      const visible = (!state.onlyMapped || Boolean(mapped)) && (!state.query || haystack.includes(state.query));
      row.hidden = !visible;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Guardado                                                            */
  /* ------------------------------------------------------------------ */

  async function saveRows() {
    if (saving) return;
    const rows = state.days
      .filter((day) => !day.removed && state.mapping.has(day.workerIndex))
      .map((day) => ({
        worker_id: state.mapping.get(day.workerIndex),
        record_date: day.date,
        status: day.status,
        entry_time: day.entry_time,
        lunch_out: day.lunch_out,
        lunch_in: day.lunch_in,
        exit_time: day.exit_time,
        observation: day.observation || ''
      }));

    if (!rows.length) {
      alert('Asigna al menos un trabajador y un día para guardar.');
      return;
    }
    if (!confirm(`Se guardarán ${rows.length} registro(s) de ${branch}. Si ya existían registros de esos días, se reemplazarán. ¿Continuar?`)) return;

    saving = true;
    saveButton.disabled = true;
    const original = saveButton.textContent;
    saveButton.textContent = 'Guardando...';
    try {
      const response = await fetch('/asistencia/biometrico/guardar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch, registered_by: 'Administrador', rows })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        if (response.status === 401) throw new Error('La sesión expiró. Recargue la página e inicie sesión nuevamente.');
        if (response.status === 413) throw new Error('El archivo es demasiado grande para el servidor. Exporte un rango de fechas más corto.');
        const message = Array.isArray(payload.errors) ? payload.errors.join('\n') : (payload.error || 'No se pudieron guardar los datos.');
        throw new Error(message);
      }
      const pageDate = document.querySelector('#quickDate')?.value || new Date().toISOString().slice(0, 10);
      window.location.href = `/asistencia?branch=${encodeURIComponent(branch)}&date=${encodeURIComponent(pageDate)}&imported=${encodeURIComponent(payload.saved)}`;
    } catch (error) {
      alert(error.message);
      saveButton.disabled = false;
      saveButton.textContent = original;
    } finally {
      saving = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    state = emptyState();
    body.hidden = true;
    loading.hidden = true;
    errorBox.hidden = true;
    errorBox.replaceChildren();
    rangeLabel.textContent = 'Selecciona el reporte Excel del biométrico.';
    statusLabel.textContent = 'Selecciona un archivo para comenzar.';
    saveButton.disabled = true;
    saveButton.textContent = 'Guardar datos';
  }

  function showLoading(message) {
    loading.hidden = false;
    loading.textContent = message;
    body.hidden = true;
    errorBox.hidden = true;
    errorBox.replaceChildren();
    rangeLabel.textContent = 'Leyendo el archivo...';
    statusLabel.textContent = message;
  }

  function showBody() {
    loading.hidden = true;
    errorBox.hidden = true;
    body.hidden = false;
  }

  function showError(message) {
    loading.hidden = true;
    body.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = message;
    rangeLabel.textContent = 'No se pudo leer el archivo.';
    statusLabel.textContent = 'Cierra esta ventana e intenta con otro archivo.';
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  }

  async function fileToBase64(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }
})();
