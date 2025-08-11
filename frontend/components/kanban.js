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
    const name=prompt('Lead name?');
    if(name){ const id=Date.now(); if(onAdd) onAdd({id,name,stage:'New'}); }
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
      if(onEdit){ const leadId=parseInt(id.replace('lead-','')); onEdit({id:leadId,name:card.dataset.name,stage:s}); }
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
      card.innerText=l.name;
      card.addEventListener('dragstart',e=>e.dataTransfer.setData('id',card.id));
      card.addEventListener('dblclick',()=>{
        const name=prompt('Lead name',l.name);
        if(!name) return;
        const stage=prompt('Stage',l.stage)||l.stage;
        if(onEdit){ onEdit({id:l.id,name,stage:stages.includes(stage)?stage:l.stage}); }
      });
      columns[l.stage].appendChild(card);
    });
  }
  return board;
}
