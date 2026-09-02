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

const attendanceRecordDate = document.querySelector('#attendanceRecordDate');
attendanceRecordDate?.addEventListener('change', () => {
  if (attendanceRecordDate.value) window.location.href = `/asistencia?date=${attendanceRecordDate.value}`;
});
