let container;
export function initToast(){
  container=document.getElementById('toast-container');
}
export function showToast(msg){
  if(!container) return;
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  container.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}
