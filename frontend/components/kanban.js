import { skeletonCard } from './skeleton.js';
import { showToast } from './toast.js';

const stages=['New','Contacted','Qualified','Proposal','Closed'];

export function createKanban(leads=[]) {
  const board=document.createElement('div');
  board.className='kanban';
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
      columns[l.stage].appendChild(card);
    });
  }
  return board;
}
