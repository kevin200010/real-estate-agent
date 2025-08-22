// Modal form for booking appointments with calendar and time slots
export async function openAppointmentForm(property){
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

  // Default daily time slots
  const defaultTimes = ['9:00 AM', '11:00 AM', '1:00 PM'];

  const API_BASE = window.API_BASE_URL || 'http://localhost:8000';

  async function authHeader(){
    try{
      const token = (await window.aws_amplify.Auth.currentSession()).getIdToken().getJwtToken();
      return { Authorization: token };
    }catch{
      return {};
    }
  }

  // Fetch booked events from backend
  const booked = {};
  try {
    const res = await fetch(`${API_BASE}/appointments`, { headers: await authHeader() });
    const data = await res.json();
    data.forEach(ev => {
      const d = new Date(ev.start);
      const day = d.getDate();
      const time = d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
      booked[day] = booked[day] || [];
      booked[day].push(time);
    });
  } catch (err) {
    console.error('Failed to load appointments', err);
  }

  // Build availability map based on booked slots
  const availability = {};

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  for(let day=1; day<=daysInMonth; day++){
    const avail = defaultTimes.filter(t => !(booked[day]||[]).includes(t));
    if(avail.length) availability[day] = avail;
  }

  const calendarEl = form.querySelector('#apptCalendar');
  const timesEl = form.querySelector('#apptTimes');

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
    } else if(booked[day]) {
      cell.classList.add('booked');
    }
    grid.appendChild(cell);
  }
  calendarEl.appendChild(grid);

  let selectedDay = null;
  let selectedTime = null;

  function renderTimeSlots(day){
    timesEl.innerHTML = '';
    defaultTimes.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t;
      btn.className = 'time-slot';
      if((booked[day]||[]).includes(t)){
        btn.classList.add('booked');
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => {
          selectedTime = t;
          form.time.value = t;
          timesEl.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      }
      timesEl.appendChild(btn);
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if(!form.date.value || !form.time.value){
      alert('Please select a date and time.');
      return;
    }
    const { name, phone, email, date, time } = form;
    try {
      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          name: name.value,
          phone: phone.value,
          email: email.value,
          date: date.value,
          time: time.value
        })
      });
      if(!res.ok) throw new Error('Failed to book appointment');
      // Remove slot from UI
      booked[selectedDay] = booked[selectedDay] || [];
      booked[selectedDay].push(selectedTime);
      availability[selectedDay] = availability[selectedDay].filter(t => t!==selectedTime);
      renderTimeSlots(selectedDay);
      if(!availability[selectedDay].length){
        document.querySelectorAll('.calendar-day')[selectedDay+6+firstDay-1]?.classList.remove('available');
      }
      alert(`Appointment booked on ${date.value} at ${time.value} for ${name.value}.`);
      close();
    } catch(err){
      alert('Unable to book appointment.');
    }
  });

  form.querySelector('#cancelAppointment').addEventListener('click', close);
  overlay.appendChild(form);
  document.body.appendChild(overlay);
}

