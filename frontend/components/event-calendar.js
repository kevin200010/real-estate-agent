export function createEventCalendar(events = []) {
  const now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth();
  const todayStr = now.toISOString().split('T')[0];
  let selected = todayStr;

  const eventsByDate = {};
  events.forEach(ev => {
    const dateStr = ev.start.split('T')[0];
    if (!eventsByDate[dateStr]) eventsByDate[dateStr] = [];
    eventsByDate[dateStr].push(ev);
  });

  const cal = document.createElement('div');
  cal.className = 'calendar';
  cal.tabIndex = 0;

  const nav = document.createElement('div');
  nav.className = 'calendar-nav';
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '<';
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '>';
  nav.append(prevBtn, nextBtn);

  const monthsWrap = document.createElement('div');
  monthsWrap.className = 'calendar-months';

  const list = document.createElement('div');
  list.className = 'calendar-events';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function buildMonth(year, month) {
    const monthEl = document.createElement('div');
    monthEl.className = 'calendar-month';

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    dayNames.forEach(d => {
      const dn = document.createElement('div');
      dn.className = 'day-name';
      dn.textContent = d;
      grid.appendChild(dn);
    });

    const firstDay = new Date(year, month, 1).getDay();
    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const btn = document.createElement('button');
      btn.className = 'calendar-day';
      btn.textContent = String(day);
      if (dateStr === todayStr) btn.classList.add('today');
      if (eventsByDate[dateStr]) btn.classList.add('has-event');
      if (dateStr === selected) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        selected = dateStr;
        cal.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
        btn.classList.add('selected');
        renderEvents();
      });
      grid.appendChild(btn);
    }

    monthEl.append(header, grid);
    return monthEl;
  }

  function buildMonths() {
    monthsWrap.innerHTML = '';
    monthsWrap.appendChild(buildMonth(currentYear, currentMonth));
  }

  function shiftMonth(delta) {
    const d = new Date(currentYear, currentMonth + delta, 1);
    currentYear = d.getFullYear();
    currentMonth = d.getMonth();
    buildMonths();
  }

  prevBtn.addEventListener('click', () => shiftMonth(-1));
  nextBtn.addEventListener('click', () => shiftMonth(1));
  cal.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    if (e.key === 'ArrowRight') shiftMonth(1);
  });

  buildMonths();

  cal.append(nav, monthsWrap, list);

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

  renderEvents();
  return cal;
}
