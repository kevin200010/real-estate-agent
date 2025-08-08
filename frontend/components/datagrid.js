import { skeletonRow } from './skeleton.js';

export function createDataGrid(props=[]) {
  const el = document.createElement('div');
  el.id='grid';
  const sk = document.createElement('div');
  for(let i=0;i<5;i++) sk.appendChild(skeletonRow());
  el.appendChild(sk);
  setTimeout(()=>render(),800);
  function render(){
    el.innerHTML = `<table class="data"><thead><tr><th>Address</th><th>Price</th></tr></thead><tbody>`+
      props.map(p=>`<tr><td>${p.address}</td><td>${p.price}</td></tr>`).join('')+
      `</tbody></table>`;
  }
  return el;
}
