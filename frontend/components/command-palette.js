let palette,input,listEl,items=[],filtered=[],current=0;

export function initCommandPalette(data) {
  palette = document.getElementById('command-palette');
  palette.innerHTML = `<div class="cp-box"><input id="cp-input" placeholder="Type a command"/><div class="cp-list"></div></div>`;
  input = palette.querySelector('#cp-input');
  listEl = palette.querySelector('.cp-list');
  items = [
    {label:'Go to Sourcing', action:()=>location.hash='#/sourcing'},
    {label:'Go to Leads', action:()=>location.hash='#/leads'},
    {label:'Go to Outreach', action:()=>location.hash='#/outreach'},
  ];
  (data.savedSearches||[]).forEach(s=>items.push({label:`Search: ${s}`, action:()=>alert('Load '+s)}));
  filtered = items;
  render();
  input.addEventListener('input',()=>{filter();});
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){current=Math.min(current+1,filtered.length-1);render();}
    else if(e.key==='ArrowUp'){current=Math.max(current-1,0);render();}
    else if(e.key==='Enter'){execute();}
    else if(e.key==='Escape'){togglePalette();}
  });
}

function render(){
  listEl.innerHTML = filtered.map((it,i)=>`<div class="cp-item${i===current?' active':''}" data-idx="${i}">${it.label}</div>`).join('');
  listEl.querySelectorAll('.cp-item').forEach(el=>el.addEventListener('click',()=>{current=Number(el.dataset.idx);execute();}));
}

function filter(){
  const q=input.value.toLowerCase();
  filtered = items.filter(it=>it.label.toLowerCase().includes(q));
  current=0;render();
}

export function togglePalette(){
  palette.classList.toggle('hidden');
  if(!palette.classList.contains('hidden')){input.value='';filter();setTimeout(()=>input.focus(),0);} 
}

function execute(){
  const cmd = filtered[current];
  if(cmd){togglePalette();cmd.action();}
}
