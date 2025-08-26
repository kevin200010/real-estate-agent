export function createLeadsView(state){
  const wrap=document.createElement('div');
  wrap.className='leads-page';

  // Grid of saved properties
  const grid=document.createElement('div');
  grid.className='leads-grid';
  const controls=document.createElement('div');
  const bulk=document.createElement('button');
  bulk.textContent='Remove Selected';
  controls.appendChild(bulk);
  grid.appendChild(controls);
  const table=document.createElement('table');
  table.className='data';
  table.innerHTML='<thead><tr><th><input type="checkbox" id="select-all"></th><th>Address</th><th>Status</th><th>Details</th></tr></thead><tbody></tbody>';
  grid.appendChild(table);
  const tbody=table.querySelector('tbody');

  function persistSaved(){
    const ids=state.data.savedProperties.map(p=>String(p.id));
    localStorage.setItem('savedProperties',JSON.stringify(ids));
  }
  function persistStatuses(){
    localStorage.setItem('leadStatuses',JSON.stringify(state.data.leadStatuses));
  }

  function renderRows(){
    tbody.innerHTML='';
    state.data.savedProperties.forEach(p=>{
      const tr=document.createElement('tr');
      tr.dataset.id=p.id;
      const status=state.data.leadStatuses[p.id]||'';
      tr.innerHTML=`<td><input type="checkbox" class="row-select"></td><td>${p.address}</td><td><select class="status">
        <option value=""></option>
        <option>Applied</option>
        <option>Viewed</option>
        <option>Docs stage</option>
        <option>Good</option>
        <option>Better</option>
        <option>Best</option>
      </select></td><td><button class="details">View</button></td>`;
      const sel=tr.querySelector('select.status');
      sel.value=status;
      sel.addEventListener('change',()=>{
        state.data.leadStatuses[p.id]=sel.value;
        persistStatuses();
      });
      tr.querySelector('button.details').addEventListener('click',()=>{location.hash=`#/property?prop=${p.id}`;});
      tbody.appendChild(tr);
    });
  }
  renderRows();

  table.querySelector('#select-all').addEventListener('change',e=>{
    const checked=e.target.checked;
    tbody.querySelectorAll('input.row-select').forEach(cb=>cb.checked=checked);
  });

  bulk.addEventListener('click',()=>{
    const ids=[];
    tbody.querySelectorAll('input.row-select:checked').forEach(cb=>ids.push(cb.closest('tr').dataset.id));
    state.data.savedProperties=state.data.savedProperties.filter(p=>!ids.includes(String(p.id)));
    persistSaved();
    renderRows();
  });

  wrap.appendChild(grid);

  // Calendar panel
  const calendar=document.createElement('div');
  calendar.className='calendar-panel';
  const addBtn=document.createElement('button');
  addBtn.textContent='Add Booking';
  calendar.appendChild(addBtn);
  const list=document.createElement('ul');
  calendar.appendChild(list);

  function persistBookings(){
    localStorage.setItem('bookings',JSON.stringify(state.data.bookings));
  }

  function renderBookings(){
    list.innerHTML='';
    const items=[...state.data.bookings].sort((a,b)=>new Date(a.datetime)-new Date(b.datetime));
    items.forEach(b=>{
      const prop=state.data.properties.find(x=>String(x.id)===String(b.propertyId));
      const li=document.createElement('li');
      li.innerHTML=`<strong>${new Date(b.datetime).toLocaleString()}</strong><br>${prop?prop.address:''}<br>${b.name}
        <div><button data-id="${b.id}" class="edit">Edit</button> <button data-id="${b.id}" class="delete">Delete</button></div>`;
      list.appendChild(li);
    });
  }
  renderBookings();

  function openForm(existing=null){
    const overlay=document.createElement('div');overlay.className='modal';
    const form=document.createElement('form');form.className='booking-form';
    form.innerHTML=`<h2>${existing?'Edit':'New'} Booking</h2>
      <label>Property<select name="property" required>${state.data.savedProperties.map(p=>`<option value="${p.id}">${p.address}</option>`).join('')}</select></label>
      <label>Name<input name="name" required></label>
      <label>Phone<input name="phone" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Preferred Time<input type="datetime-local" name="datetime" required></label>
      <label>Notes<textarea name="notes"></textarea></label>
      <div class='form-actions'><button type='submit'>Save</button><button type='button' id='cancel'>Cancel</button></div>`;
    if(existing){
      form.property.value=existing.propertyId;
      form.name.value=existing.name;
      form.phone.value=existing.phone;
      form.email.value=existing.email;
      form.datetime.value=existing.datetime;
      form.notes.value=existing.notes||'';
    }
    const close=()=>overlay.remove();
    form.querySelector('#cancel').addEventListener('click',close);
    overlay.addEventListener('click',e=>{if(e.target===overlay) close();});
    form.addEventListener('submit',e=>{
      e.preventDefault();
      if(!form.reportValidity()) return;
      const booking={
        id: existing?existing.id:Date.now(),
        propertyId: form.property.value,
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        email: form.email.value.trim(),
        datetime: form.datetime.value,
        notes: form.notes.value.trim()
      };
      if(existing){
        const i=state.data.bookings.findIndex(x=>x.id===existing.id);
        if(i>-1) state.data.bookings[i]=booking;
      } else {
        state.data.bookings.push(booking);
      }
      persistBookings();
      renderBookings();
      close();
    });
    overlay.appendChild(form);
    document.body.appendChild(overlay);
  }

  addBtn.addEventListener('click',()=>openForm());
  list.addEventListener('click',e=>{
    const id=e.target.dataset.id;
    if(e.target.classList.contains('edit')){
      const b=state.data.bookings.find(x=>String(x.id)===String(id));
      if(b) openForm(b);
    } else if(e.target.classList.contains('delete')){
      state.data.bookings=state.data.bookings.filter(x=>String(x.id)!==String(id));
      persistBookings();
      renderBookings();
    }
  });

  wrap.appendChild(calendar);
  return wrap;
}
