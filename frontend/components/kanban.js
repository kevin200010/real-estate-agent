import { skeletonCard } from './skeleton.js';
import { showToast } from './toast.js';

const stages=['New','Contacted','Qualified','Proposal','Closed'];

export function createKanban(leads=[],callbacks={}) {
  const {onAdd,onEdit}=callbacks;
  const board=document.createElement('div');
  board.className='kanban';
  const controls=document.createElement('div');
  const addBtn=document.createElement('button');
  addBtn.textContent='Add Lead';
  addBtn.addEventListener('click',()=>{
    if(onAdd) onAdd();
  });
  controls.appendChild(addBtn);
  board.appendChild(controls);
  const columns={};
  stages.forEach(s=>{
    const col=document.createElement('div');
    col.className='kanban-column';
    col.dataset.stage=s;
    col.innerHTML=`<h3>${s}</h3>`;
    const sk=document.createElement('div');for(let i=0;i<3;i++) sk.appendChild(skeletonCard());
    col.appendChild(sk);
    col.addEventListener('dragover',e=>e.preventDefault());
    col.addEventListener('drop',e=>{
      const id=e.dataTransfer.getData('id');
      const card=document.getElementById(id);
      col.appendChild(card);
      showToast(`Moved ${card.dataset.name} to ${s}`);
      if(onEdit){ const leadId=parseInt(id.replace('lead-','')); onEdit({id:leadId,name:card.dataset.name,stage:s,property:card.dataset.property,email:card.dataset.email,phone:card.dataset.phone}); }
    });
    board.appendChild(col);
    columns[s]=col;
  });
  setTimeout(()=>render(),800);
  function render(){
    stages.forEach(s=>{columns[s].innerHTML=`<h3>${s}</h3>`});
    leads.forEach(l=>{
      const card=document.createElement('div');
      card.className='lead-card';
      card.draggable=true;
      card.id='lead-'+l.id;
      card.dataset.name=l.name;
      card.dataset.property=l.property||'';
      card.dataset.email=l.email||'';
      card.dataset.phone=l.phone||'';
      card.innerHTML=`<strong>${l.name}</strong>${l.property?`<br/><small>${l.property}</small>`:''}`;
      card.addEventListener('dragstart',e=>e.dataTransfer.setData('id',card.id));
      card.addEventListener('dblclick',()=>{
        const name=prompt('Lead name',l.name);
        if(!name) return;
        const stage=prompt('Stage',l.stage)||l.stage;
        const property=prompt('Property',l.property||'')||l.property||'';
        const email=prompt('Email',l.email||'')||l.email||'';
        const phone=prompt('Phone',l.phone||'')||l.phone||'';
        if(onEdit){ onEdit({id:l.id,name,stage:stages.includes(stage)?stage:l.stage,property,email,phone}); }
      });
      columns[l.stage].appendChild(card);
    });
  }
  return board;
}
