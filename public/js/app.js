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
