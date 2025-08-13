async function post(url,data){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(!res.ok) throw new Error('request failed');
  return await res.json();
}

const loginForm=document.getElementById('login-form');
const content=document.getElementById('content');
const slotsInput=document.getElementById('slots');
const saveSlots=document.getElementById('save-slots');
const availabilityList=document.getElementById('availability-list');
const appointmentsList=document.getElementById('appointments');
let currentUser=null;

loginForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(loginForm);
  try{
    currentUser=await post('/login', Object.fromEntries(fd.entries()));
    loginForm.style.display='none';
    content.style.display='block';
    loadAvailability();
    loadAppointments();
  }catch(err){ alert('login failed'); }
});

saveSlots.addEventListener('click', async()=>{
  const slots=slotsInput.value.split(',').map(s=>s.trim()).filter(Boolean);
  await post('/availability',{slots});
  loadAvailability();
});

async function loadAvailability(){
  const res=await fetch('/availability');
  const data=await res.json();
  availabilityList.innerHTML='';
  data.slots.forEach(s=>{
    const li=document.createElement('li');
    li.textContent=s;
    availabilityList.appendChild(li);
  });
}

async function loadAppointments(){
  const res=await fetch('/appointments');
  const data=await res.json();
  appointmentsList.innerHTML='';
  data.forEach(a=>{
    const li=document.createElement('li');
    li.textContent=`${a.user} - ${a.property_id} at ${a.slot}`;
    appointmentsList.appendChild(li);
  });
}
