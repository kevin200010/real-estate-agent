// Modal form for booking appointments with calendar and time slots
export function openAppointmentForm(property){
  const overlay = document.createElement('div');
  overlay.className = 'modal';

  const form = document.createElement('form');
  form.className = 'appointment-form';

  const fullAddress = property ? (property.city ? `${property.address}, ${property.city}` : property.address) : '';

  form.innerHTML = `
    <h2>Book Appointment${fullAddress ? ` for ${fullAddress}` : ''}</h2>
    <div class="calendar" id="apptCalendar"></div>
    <div class="time-slots" id="apptTimes"></div>
    <label>Name<input name="name" required /></label>
    <label>Phone<input name="phone" required /></label>
    <label>Email<input type="email" name="email" required /></label>
    <input type="hidden" name="date" />
    <input type="hidden" name="time" />
    <div class='form-actions'>
      <button type='submit'>Book</button>
      <button type='button' id='cancelAppointment'>Cancel</button>
    </div>`;

  const close = () => { overlay.remove(); };
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });

  // Availability for the current month: day -> time slots
  const availability = {
    5: ['9:00 AM', '11:00 AM', '1:00 PM'],
    12: ['10:00 AM', '2:00 PM', '4:00 PM'],
    19: ['9:30 AM', '12:30 PM', '3:30 PM'],
    26: ['11:00 AM', '1:00 PM', '3:00 PM']
  };

  let selectedDay = null;
  let selectedTime = null;

  const calendarEl = form.querySelector('#apptCalendar');
  const timesEl = form.querySelector('#apptTimes');

  // Build calendar for current month
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dayNames.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'day-name';
    cell.textContent = d;
    grid.appendChild(cell);
  });
  for(let i=0;i<firstDay;i++){
    grid.appendChild(document.createElement('div'));
  }
  for(let day=1; day<=daysInMonth; day++){
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.textContent = day;
    cell.className = 'calendar-day';
    if(availability[day]){
      cell.classList.add('available');
      cell.addEventListener('click', () => {
        selectedDay = day;
        form.date.value = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
        cell.classList.add('selected');
        renderTimeSlots(day);
      });
    }
    grid.appendChild(cell);
  }
  calendarEl.appendChild(grid);

  function renderTimeSlots(day){
    const times = availability[day] || [];
    timesEl.innerHTML = '';
    times.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t;
      btn.className = 'time-slot';
      btn.addEventListener('click', () => {
        selectedTime = t;
        form.time.value = t;
        timesEl.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      timesEl.appendChild(btn);
    });
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    if(!form.date.value || !form.time.value){
      alert('Please select a date and time.');
      return;
    }
    const { name, phone, email, date, time } = form;
    alert(`Appointment booked on ${date.value} at ${time.value} for ${name.value}. We will contact you at ${phone.value}.`);
    close();
  });

  form.querySelector('#cancelAppointment').addEventListener('click', close);
  overlay.appendChild(form);
  document.body.appendChild(overlay);
}

