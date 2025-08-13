async function post(url, data){
  const res = await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
  if(!res.ok) throw new Error('request failed');
  return await res.json();
}

const loginForm=document.getElementById('login-form');
const content=document.getElementById('content');
const propertyList=document.getElementById('property-list');
const appointmentList=document.getElementById('appointment-list');
let currentUser=null;

loginForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(loginForm);
  try{
    currentUser=await post('/login', Object.fromEntries(fd.entries()));
    loginForm.style.display='none';
    content.style.display='block';
    loadProperties();
    loadAppointments();
  }catch(err){ alert('login failed'); }
});

async function loadProperties(){
  const res=await fetch('/properties');
  const props=await res.json();
  propertyList.innerHTML='';
  props.forEach(p=>{
    const li=document.createElement('li');
    li.textContent=`${p.location} - $${p.price}`;
    const btn=document.createElement('button');
    btn.textContent='Book';
    btn.addEventListener('click', async ()=>{
      const slot=prompt('Preferred slot?');
      if(!slot) return;
      await post('/appointments',{property_id:p.id, slot, user:currentUser.username});
      loadAppointments();
    });
    li.appendChild(btn);
    propertyList.appendChild(li);
  });
}

async function loadAppointments(){
  const res=await fetch('/appointments');
  const appts=await res.json();
  appointmentList.innerHTML='';
  appts.filter(a=>a.user===currentUser.username).forEach(a=>{
    const li=document.createElement('li');
    li.textContent=`${a.property_id} at ${a.slot}`;
    appointmentList.appendChild(li);
  });
}
