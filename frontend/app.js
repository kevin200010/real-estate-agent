import { initTopbar } from './components/topbar.js';
import { initLeftRail } from './components/left-rail.js';
import { initAssistantDrawer } from './components/assistant-drawer.js';
import { initCommandPalette, togglePalette } from './components/command-palette.js';
import { createDataGrid } from './components/datagrid.js';
import { createKanban } from './components/kanban.js';
import { initToast } from './components/toast.js';
import { createAgentChat } from './components/agent-chat.js';

if (window.GOOGLE_MAPS_API_KEY) {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}`;
  script.async = true;
  script.onload = () => {
    if (location.hash.startsWith('#/sourcing')) {
      router();
    }
  };
  document.head.appendChild(script);
}

const state={ data:{} };
let topbarAPI;

// cycle through simple real-estate themed backgrounds
const backgrounds=['property1.jpg','property2.png','property3.jpg'];
let bgIndex=0;

fetch('data/sample.json').then(r=>r.json()).then(d=>{state.data=d;init();});

function init(){
  topbarAPI=initTopbar();
  initLeftRail(state.data);
  initAssistantDrawer();
  initCommandPalette(state.data);
  initToast();
  window.addEventListener('hashchange',router);
  router();
  setupShortcuts();
  setupBackground();
}

function router(){
  const hash=location.hash||'#/sourcing';
  const main=document.getElementById('main');
  main.innerHTML='';
  if(hash.startsWith('#/sourcing')){
    topbarAPI.setActive('#/sourcing');
    const wrap=document.createElement('div');
    wrap.className='sourcing-view';
    const map=document.createElement('div');map.id='map';
    const addBtn=document.createElement('button');
    addBtn.textContent='Add Property';
    addBtn.addEventListener('click',()=>{
      const address=prompt('Address?');
      const price=prompt('Price?');
      const lat=parseFloat(prompt('Latitude?'));
      const lng=parseFloat(prompt('Longitude?'));
      if(address&&price&&!isNaN(lat)&&!isNaN(lng)){
        const id=Date.now();
        state.data.properties=state.data.properties||[];
        state.data.properties.push({id,address,price,lat,lng});
        router();
      }
    });
    const grid=createDataGrid(state.data.properties||[]);
    wrap.append(map,addBtn,grid);
    main.appendChild(wrap);
    if(window.google&&window.google.maps&&state.data.properties&&state.data.properties.length){
      const first=state.data.properties[0];
      const gmap=new google.maps.Map(map,{center:{lat:first.lat,lng:first.lng},zoom:10});
      state.data.properties.forEach(p=>{
        if(p.lat&&p.lng){
          new google.maps.marker.AdvancedMarkerElement({position:{lat:p.lat,lng:p.lng},map:gmap,title:p.address});
        }
      });
    }
  } else if(hash.startsWith('#/leads')){
    topbarAPI.setActive('#/leads');
    const board=createKanban(state.data.leads||[],{
      onAdd:l=>{state.data.leads.push(l);router();},
      onEdit:l=>{
        const i=state.data.leads.findIndex(x=>x.id===l.id);
        if(i>-1) state.data.leads[i]=l; else state.data.leads.push(l);
        router();
      }
    });
    main.appendChild(board);
  } else if(hash.startsWith('#/outreach')){
    topbarAPI.setActive('#/outreach');
    main.appendChild(createOutreach());
  } else if(hash.startsWith('#/agent')){
    topbarAPI.setActive('#/agent');
    main.appendChild(createAgentChat());
  }
}

function createOutreach(){
  const view=document.createElement('div');view.className='outreach-view';
  const cohorts=document.createElement('div');cohorts.className='cohorts';
  (state.data.cohorts||[]).forEach(c=>{
    const item=document.createElement('div');item.textContent=c.name;cohorts.appendChild(item);
  });
  const editor=document.createElement('div');editor.className='editor';
  const textarea=document.createElement('textarea');textarea.value=(state.data.templates&&state.data.templates[0].body)||'';
  const timeline=document.createElement('div');timeline.className='timeline';timeline.textContent='Sequence timeline';
  editor.append(textarea,timeline);
  view.append(cohorts,editor);
  return view;
}

function setupShortcuts(){
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); togglePalette(); }
  });
}

function setupBackground(){
  const bg=document.getElementById('bg');
  if(!bg) return;
  bg.style.backgroundImage=`url('${backgrounds[0]}')`;
  setInterval(()=>{
    bg.style.opacity=0;
    bg.classList.add('changing');
    setTimeout(()=>{
      bgIndex=(bgIndex+1)%backgrounds.length;
      bg.style.backgroundImage=`url('${backgrounds[bgIndex]}')`;
      bg.style.opacity=1;
      bg.classList.remove('changing');
    },1000);
  },10000);
}
