export function createEventCalendar(events = []) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  const eventsByDate = {};
  events.forEach(ev => {
    const dateStr = ev.start.split('T')[0];
    if (!eventsByDate[dateStr]) eventsByDate[dateStr] = [];
    eventsByDate[dateStr].push(ev);
  });

  const cal = document.createElement('div');
  cal.className = 'calendar';

  const header = document.createElement('div');
  header.className = 'calendar-header';
  header.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  cal.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(d => {
    const dn = document.createElement('div');
    dn.className = 'day-name';
    dn.textContent = d;
    grid.appendChild(dn);
  });

  const firstDay = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const list = document.createElement('div');
  list.className = 'calendar-events';
  let selected = null;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.className = 'calendar-day';
    btn.textContent = String(day);
    if (eventsByDate[dateStr]) btn.classList.add('has-event');
    btn.addEventListener('click', () => {
      selected = dateStr;
      cal.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
      btn.classList.add('selected');
      renderEvents();
    });
    grid.appendChild(btn);
  }

  cal.appendChild(grid);
  cal.appendChild(list);

  function renderEvents() {
    list.innerHTML = '';
    const evs = eventsByDate[selected] || [];
    if (evs.length === 0) {
      list.textContent = 'No appointments';
      return;
    }
    evs.forEach(ev => {
      const item = document.createElement('div');
      const date = new Date(ev.start);
      const time = ev.start.includes('T') ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      item.textContent = `${time} ${ev.summary || ''}`.trim();
      list.appendChild(item);
    });
  }

  return cal;
}
