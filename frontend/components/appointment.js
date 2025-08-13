export function openAppointmentForm(property){
  const overlay=document.createElement('div');
  overlay.className='modal';
  const form=document.createElement('form');
  form.className='appointment-form';
  const slots=['9:00 AM','11:00 AM','1:00 PM','3:00 PM'];
  const options=slots.map(s=>`<option value="${s}">${s}</option>`).join('');
  const fullAddress=property? (property.city?`${property.address}, ${property.city}`:property.address):'';
  form.innerHTML=`<h2>Book Appointment${fullAddress?` for ${fullAddress}`:''}</h2>
    <label>Available Slots:<select name='slot'>${options}</select></label>
    <div class='form-actions'>
      <button type='submit'>Book</button>
      <button type='button' id='cancelAppointment'>Cancel</button>
    </div>`;
  const close=()=>{ overlay.remove(); };
  overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const slot=form.slot.value;
    alert(`Appointment booked for ${slot}`);
    close();
  });
  form.querySelector('#cancelAppointment').addEventListener('click',close);
  overlay.appendChild(form);
  document.body.appendChild(overlay);
}
