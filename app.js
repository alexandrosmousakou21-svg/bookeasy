const icons = () => window.lucide?.createIcons();
const modal = document.querySelector('#bookingModal');
const toast = document.querySelector('#toast');
const scheduleList = document.querySelector('#scheduleList');
const sidebar = document.querySelector('#sidebar');

icons();

function setModal(open) {
  modal.classList.toggle('open', open);
  modal.setAttribute('aria-hidden', String(!open));
  if (open) modal.querySelector('input')?.focus();
}

document.querySelector('#newBooking').addEventListener('click', () => setModal(true));
document.querySelector('#closeModal').addEventListener('click', () => setModal(false));
document.querySelector('#cancelModal').addEventListener('click', () => setModal(false));
modal.addEventListener('click', (event) => { if (event.target === modal) setModal(false); });

document.querySelector('#bookingForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const client = form.get('client');
  const service = form.get('service');
  const time = form.get('time');
  const [hours, minutes] = time.split(':');
  const hour = Number(hours) > 12 ? Number(hours) - 12 : Number(hours);
  const meridiem = Number(hours) >= 12 ? 'PM' : 'AM';
  const appointment = document.createElement('div');
  appointment.className = 'appointment';
  appointment.innerHTML = `<div class="time-col"><strong>${String(hour).padStart(2, '0')}:${minutes}</strong><span>${meridiem}</span></div><div class="timeline-dot"></div><div class="appointment-body"><div class="appointment-main"><div class="client-avatar avatar-pink">${client.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><strong>${client}</strong><span>${service}</span></div></div><div class="appointment-meta"><span class="status-pill confirmed"><i data-lucide="check"></i> Confirmed</span><button class="more-button" aria-label="More options"><i data-lucide="more-horizontal"></i></button></div></div>`;
  scheduleList.append(appointment);
  icons();
  setModal(false);
  event.currentTarget.reset();
  showToast(`Booking for ${client} created`);
});

function showToast(message) {
  toast.querySelector('span').textContent = message;
  toast.classList.add('show');
  window.clearTimeout(window.toastTimer);
  window.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3000);
}

document.querySelector('#availabilityToggle').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.classList.toggle('active');
  const status = button.parentElement.querySelector('strong');
  const detail = button.parentElement.querySelector('span');
  const available = button.classList.contains('active');
  status.textContent = available ? 'You’re available' : 'You’re unavailable';
  detail.textContent = available ? 'Accepting new bookings' : 'Bookings are paused';
  showToast(available ? 'Availability turned on' : 'Availability turned off');
});

document.querySelector('#loadMore').addEventListener('click', (event) => {
  event.currentTarget.innerHTML = 'All appointments loaded <i data-lucide="check"></i>';
  event.currentTarget.disabled = true;
  icons();
});

document.querySelector('#copyLink').addEventListener('click', async () => {
  const link = 'bookeasy.co/atelier-north';
  try { await navigator.clipboard.writeText(link); } catch { /* Clipboard can be unavailable on local files. */ }
  document.querySelector('#copyFeedback').classList.add('show');
  showToast('Booking link copied');
  window.setTimeout(() => document.querySelector('#copyFeedback').classList.remove('show'), 2600);
});

document.querySelector('#openSidebar').addEventListener('click', () => sidebar.classList.add('open'));
document.querySelector('#closeSidebar').addEventListener('click', () => sidebar.classList.remove('open'));
document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
  item.classList.add('active');
  document.querySelector('#pageTitle').textContent = item.querySelector('span').textContent;
  sidebar.classList.remove('open');
  if (item.dataset.view !== 'overview') showToast(`${item.querySelector('span').textContent} view selected`);
}));

document.querySelector('#viewCalendar').addEventListener('click', () => {
  document.querySelector('[data-view="calendar"]').click();
});
document.querySelector('#editHours').addEventListener('click', () => showToast('Availability settings opened'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setModal(false); });