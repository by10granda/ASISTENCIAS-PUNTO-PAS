const statusSelect = document.querySelector('#statusSelect');
const fields = document.querySelectorAll('.status-field');

function toggleAttendanceFields() {
  if (!statusSelect) return;
  const value = statusSelect.value;
  fields.forEach((field) => field.classList.add('hidden'));
  document.querySelectorAll('.status-field input').forEach((input) => input.required = false);
  if (value === 'ASISTENCIA NORMAL') showGroup('normal');
  if (value === 'FALTA JUSTIFICADA') showGroup('justified');
  if (value === 'ATRASO') showGroup('late');
  if (value === 'PERMISO') showGroup('permit');
}

function showGroup(name) {
  document.querySelectorAll(`.${name}`).forEach((field) => field.classList.remove('hidden'));
}

statusSelect?.addEventListener('change', toggleAttendanceFields);
toggleAttendanceFields();

document.querySelectorAll('.confirm-important').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!confirm('Confirme que desea guardar esta informacion.')) event.preventDefault();
  });
});

// Convierte el certificado adjunto a base64 para enviarlo dentro del formulario.
const certificateInput = document.querySelector('#certificateInput');
certificateInput?.addEventListener('change', async () => {
  const dataField = document.querySelector('#certificateData');
  const nameField = document.querySelector('#certificateFileName');
  const mimeField = document.querySelector('#certificateMimeType');
  if (!dataField) return;
  dataField.value = '';
  nameField.value = '';
  mimeField.value = '';
  const file = certificateInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert('El archivo supera los 10 MB permitidos.');
    certificateInput.value = '';
    return;
  }
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  dataField.value = btoa(binary);
  nameField.value = file.name;
  mimeField.value = file.type || '';
});

document.querySelectorAll('.delete-worker-form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const input = form.querySelector('[name="confirm_delete"]');
    if (input?.value !== 'ELIMINAR') {
      alert('Debe escribir exactamente la palabra ELIMINAR para continuar.');
      event.preventDefault();
      return;
    }
    if (!confirm('Esta accion eliminara definitivamente al trabajador y todo su historial. No se puede deshacer.')) event.preventDefault();
  });
});

const attendanceRecordDate = document.querySelector('#attendanceRecordDate');
attendanceRecordDate?.addEventListener('change', () => {
  if (!attendanceRecordDate.value) return;
  const params = new URLSearchParams(window.location.search);
  params.set('date', attendanceRecordDate.value);
  window.location.href = `/asistencia?${params.toString()}`;
});

// ---- Registro rapido por sucursal ----
const quickFilterForm = document.querySelector('#quickFilterForm');
const quickBranch = document.querySelector('#quickBranch');
quickBranch?.addEventListener('change', () => {
  if (!quickFilterForm || !quickBranch.value) return;
  quickFilterForm.submit();
});
document.querySelector('#quickDate')?.addEventListener('change', () => {
  if (!quickFilterForm || !quickBranch?.value) return;
  quickFilterForm.submit();
});

const quickForm = document.querySelector('#quickForm');
if (quickForm) {
  const quickEntryTime = quickForm.querySelector('#quickEntryTime');
  const quickScheduled = quickForm.querySelector('#quickScheduled');
  const quickSummary = quickForm.querySelector('#quickSummary');
  const quickRows = () => [...quickForm.querySelectorAll('tbody tr[data-worker]')];

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  }

  function updateQuickLate(row) {
    const status = row.querySelector('.quick-status')?.value || '';
    const cell = row.querySelector('.quick-late');
    if (!cell) return;
    const time = row.querySelector('.quick-time')?.value || '';
    const scheduledValue = row.dataset.scheduled || quickScheduled?.value || '';
    const scheduled = timeToMinutes(scheduledValue);
    const actual = timeToMinutes(time);
    if (status !== 'ATRASO' || scheduled === null || actual === null) {
      cell.textContent = '-';
      return;
    }
    cell.textContent = `${Math.max(actual - scheduled, 0)} min`;
  }

  function clearQuickCertificate(row) {
    const fileInput = row.querySelector('.quick-cert-file');
    if (fileInput) fileInput.value = '';
    ['data', 'file-name', 'mime'].forEach((suffix) => {
      const field = row.querySelector(`[data-cert-${suffix}]`);
      if (field) field.value = '';
    });
    const name = row.querySelector('.cert-name');
    if (name) name.textContent = '';
  }

  function updateQuickSummary() {
    const rows = quickRows();
    const withStatus = rows.filter((row) => row.querySelector('.quick-status')?.value).length;
    const saved = rows.filter((row) => row.dataset.saved === '1').length;
    if (quickSummary) quickSummary.textContent = `${withStatus} fila(s) con estado · ${saved} ya guardadas`;
  }

  function updateQuickRow(row) {
    const status = row.querySelector('.quick-status')?.value || '';
    row.dataset.status = status;
    const time = row.querySelector('.quick-time');
    const needsTime = status === 'ASISTENCIA NORMAL' || status === 'ATRASO';
    if (time) {
      time.readOnly = !needsTime;
      if (!needsTime) {
        time.value = '';
      } else if (status === 'ATRASO' && time.value === (quickEntryTime?.value || '')) {
        time.value = '';
        time.focus();
      } else if (status === 'ASISTENCIA NORMAL' && !time.value) {
        time.value = quickEntryTime?.value || '';
      }
    }
    if (status !== 'ATRASO') {
      row.dataset.scheduled = '';
      const scheduledField = row.querySelector('.quick-row-scheduled');
      if (scheduledField) scheduledField.value = '';
    }
    if (status !== 'FALTA JUSTIFICADA') clearQuickCertificate(row);
    updateQuickLate(row);
    updateQuickSummary();
  }

  quickRows().forEach((row) => {
    const status = row.querySelector('.quick-status')?.value || '';
    row.dataset.status = status;
    const time = row.querySelector('.quick-time');
    if (time) time.readOnly = status !== 'ASISTENCIA NORMAL' && status !== 'ATRASO';
    if (row.dataset.saved !== '1') updateQuickLate(row);
  });
  updateQuickSummary();

  quickForm.querySelectorAll('.quick-status').forEach((select) => {
    select.addEventListener('change', () => updateQuickRow(select.closest('tr')));
  });
  quickForm.querySelectorAll('.quick-time').forEach((input) => {
    input.addEventListener('input', () => {
      updateQuickLate(input.closest('tr'));
      updateQuickSummary();
    });
  });
  quickForm.querySelectorAll('.quick-lunch-out').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const row = input.closest('tr');
      const lunchIn = row.querySelector('.quick-lunch-in');
      if (lunchIn) lunchIn.focus();
    });
  });
  quickForm.querySelectorAll('.quick-lunch-in').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const rows = quickRows();
      const next = rows[rows.indexOf(input.closest('tr')) + 1];
      if (next) next.querySelector('.quick-status')?.focus();
    });
  });
  quickScheduled?.addEventListener('input', () => {
    quickRows().forEach((row) => {
      if (!row.dataset.scheduled) updateQuickLate(row);
    });
  });

  quickForm.querySelector('#quickApplyTime')?.addEventListener('click', () => {
    quickRows().forEach((row) => {
      const status = row.querySelector('.quick-status')?.value;
      if (status === 'ASISTENCIA NORMAL') {
        row.querySelector('.quick-time').value = quickEntryTime?.value || '';
        updateQuickLate(row);
      }
    });
  });

  quickForm.querySelector('#quickMarkPresent')?.addEventListener('click', () => {
    quickRows().forEach((row) => {
      const select = row.querySelector('.quick-status');
      if (select.value) return;
      select.value = 'ASISTENCIA NORMAL';
      const time = row.querySelector('.quick-time');
      if (time) time.value = quickEntryTime?.value || '';
      updateQuickRow(row);
    });
  });

  quickForm.querySelector('#quickClear')?.addEventListener('click', () => {
    if (!confirm('Se limpiaran todas las filas de esta tabla. ¿Continuar?')) return;
    quickRows().forEach((row) => {
      row.querySelector('.quick-status').value = '';
      row.querySelector('.quick-obs').value = '';
      row.querySelector('.quick-lunch-out').value = '';
      row.querySelector('.quick-lunch-in').value = '';
      clearQuickCertificate(row);
      updateQuickRow(row);
    });
  });

  quickForm.querySelectorAll('.quick-cert-file').forEach((input) => {
    input.addEventListener('change', async () => {
      const worker = input.dataset.worker;
      const row = input.closest('tr');
      const dataField = row.querySelector(`[data-cert-data="${worker}"]`);
      const nameField = row.querySelector(`[data-cert-file-name="${worker}"]`);
      const mimeField = row.querySelector(`[data-cert-mime="${worker}"]`);
      const nameLabel = row.querySelector(`[data-cert-name="${worker}"]`);
      if (dataField) dataField.value = '';
      if (nameField) nameField.value = '';
      if (mimeField) mimeField.value = '';
      if (nameLabel) nameLabel.textContent = '';
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        alert('El archivo supera los 10 MB permitidos.');
        input.value = '';
        return;
      }
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      if (dataField) dataField.value = btoa(binary);
      if (nameField) nameField.value = file.name;
      if (mimeField) mimeField.value = file.type || '';
      if (nameLabel) nameLabel.textContent = file.name;
    });
  });

  quickForm.querySelectorAll('.quick-obs').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const rows = quickRows();
      const next = rows[rows.indexOf(input.closest('tr')) + 1];
      if (next) next.querySelector('.quick-status')?.focus();
    });
  });

  quickForm.addEventListener('submit', (event) => {
    const count = quickRows().filter((row) => row.querySelector('.quick-status')?.value).length;
    if (!count) {
      alert('No hay ninguna fila con estado. Marca al menos un trabajador.');
      event.preventDefault();
      return;
    }
    if (!confirm(`Se guardaran ${count} registro(s) de esta sucursal. ¿Continuar?`)) event.preventDefault();
  });
}
