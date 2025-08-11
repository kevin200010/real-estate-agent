import { initTopbar } from './components/topbar.js';
import { initLeftRail } from './components/left-rail.js';
import { initAssistantDrawer } from './components/assistant-drawer.js';
import { initCommandPalette, togglePalette } from './components/command-palette.js';
import { createDataGrid } from './components/datagrid.js';
import { createKanban } from './components/kanban.js';
import { initToast } from './components/toast.js';
import { createAgentChat } from './components/agent-chat.js';

const mapReady = new Promise(resolve => {
  if (window.GOOGLE_MAPS_API_KEY) {
    const script = document.createElement('script');
    // use only the marker lib; weekly channel
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}&libraries=marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    document.head.appendChild(script);
  } else {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    document.head.appendChild(script);
  }
});

const state={ data:{}, gmap:null, markers:{}, infoWin:null };
let topbarAPI;

// cycle through simple real-estate themed backgrounds
const backgrounds=['property1.jpg','property2.png','property3.jpg'];
let bgIndex=0;

Promise.all([
  fetch('data/sample.json').then(r=>r.json()),
  fetch('data/listings.csv').then(r=>r.text()),
  mapReady
]).then(([d,csv])=>{
  d.properties=parseCSV(csv);
  state.data=d;
  init();
});

function init(){
  topbarAPI=initTopbar();
  initLeftRail(state.data);
  initAssistantDrawer();
  initCommandPalette(state.data);
  initToast();
  if(!location.hash) location.hash = '#/sourcing';
  window.addEventListener('hashchange',router);
  router();
  setupShortcuts();
  setupBackground();
}

function router(){
  const hash=location.hash||'#/sourcing';
  const [route,query]=hash.split('?');
  const main=document.getElementById('main');
  main.innerHTML='';
  if(route.startsWith('#/sourcing')){
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
    const props=state.data.properties||[];
    function selectProperty(id){
      if(!state.gmap) return;
      const p=(state.data.properties||[]).find(x=>String(x.id)===String(id));
      if(!p) return;
      const lat=Number(p.lat), lng=Number(p.lng);
      if(isNaN(lat)||isNaN(lng)) return;
      if(window.google?.maps){
        state.gmap.panTo({lat,lng});
        state.gmap.setZoom(16);
      } else if(window.L){
        state.gmap.setView([lat,lng],16);
      }
      const marker=state.markers[p.id];
      if(marker){
        if(window.google?.maps){
          state.infoWin.setContent(`<div>${p.address}<br/>${p.price}<br/><button id="addLead">Add to Leads</button></div>`);
          state.infoWin.addListener('domready',()=>{
            const btn=document.getElementById('addLead');
            if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
          });
          if(google.maps.marker?.AdvancedMarkerElement && marker instanceof google.maps.marker.AdvancedMarkerElement){
            state.infoWin.open({map:state.gmap,anchor:marker});
          } else {
            state.infoWin.open(state.gmap,marker);
            if(marker.getAnimation){
              marker.setAnimation(google.maps.Animation.BOUNCE);
              setTimeout(()=>marker.setAnimation(null),700);
            }
          }
        } else if(window.L){
          marker.openPopup();
          const popup=marker.getPopup();
          if(popup){
            const el=popup.getElement();
            if(el){
              const btn=el.querySelector('.add-lead');
              if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
            }
          }
        }
      }
      document.querySelectorAll('#grid tr.active').forEach(r=>r.classList.remove('active'));
      const row=document.querySelector(`#grid tr[data-prop-id='${p.id}']`);
      if(row) row.classList.add('active');
    }
    const grid=createDataGrid(props,selectProperty);
    wrap.append(map,addBtn,grid);
    main.appendChild(wrap);
    if(!window.google?.maps && !window.L){
      map.textContent='Loading map…';
      return;
    }
    state.markers={};
    const center=props.length?{lat:Number(props[0].lat),lng:Number(props[0].lng)}:{lat:39.5,lng:-98.35};
    const zoom=props.length?10:5;
    if(window.google?.maps){
      state.gmap=new google.maps.Map(map,{center,zoom});
      state.infoWin=state.infoWin||new google.maps.InfoWindow();
      const bounds=new google.maps.LatLngBounds();
      props.forEach(p=>{
        const lat=Number(p.lat), lng=Number(p.lng);
        if(!isNaN(lat)&&!isNaN(lng)){
          const position={lat,lng};
          let marker;
          if(google.maps.marker?.AdvancedMarkerElement){
            marker=new google.maps.marker.AdvancedMarkerElement({position,map:state.gmap,title:p.address});
          } else {
            marker=new google.maps.Marker({position,map:state.gmap,title:p.address});
          }
          state.markers[p.id]=marker;
          bounds.extend(position);
          marker.addListener('click',()=>selectProperty(p.id));
        }
      });
      if(props.length>1){state.gmap.fitBounds(bounds);}
    } else if(window.L){
      state.gmap=L.map(map).setView([center.lat,center.lng],zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(state.gmap);
      const bounds=L.latLngBounds();
      props.forEach(p=>{
        const lat=Number(p.lat), lng=Number(p.lng);
        if(!isNaN(lat)&&!isNaN(lng)){
          const position=[lat,lng];
          const marker=L.marker(position).addTo(state.gmap).bindPopup(`<div>${p.address}<br/>${p.price}<br/><button class='add-lead'>Add to Leads</button></div>`);
          state.markers[p.id]=marker;
          bounds.extend(position);
          marker.on('click',()=>selectProperty(p.id));
          marker.on('popupopen',e=>{
            const btn=e.popup.getElement().querySelector('.add-lead');
            if(btn) btn.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
          });
        }
      });
      if(props.length>1){state.gmap.fitBounds(bounds);}
    }
    } else if(route.startsWith('#/leads')){
      topbarAPI.setActive('#/leads');
      const params=new URLSearchParams(query||'');
      const propId=params.get('prop');
      if(propId){
        const p=(state.data.properties||[]).find(x=>String(x.id)===String(propId));
        const form=document.createElement('form');
        form.className='lead-form';
        form.innerHTML=`<h2>Lead for ${p?p.address:propId}</h2><label>Name:<input name='name' required/></label><button type='submit'>Save</button>`;
        form.addEventListener('submit',e=>{
          e.preventDefault();
          const name=form.name.value.trim();
          if(!name) return;
          state.data.leads=state.data.leads||[];
          state.data.leads.push({id:Date.now(),name,stage:'New',property:p?p.address:''});
          location.hash='#/leads';
        });
        main.appendChild(form);
      } else {
        const board=createKanban(state.data.leads||[],{
          onAdd:l=>{state.data.leads.push(l);router();},
          onEdit:l=>{
            const i=state.data.leads.findIndex(x=>x.id===l.id);
            if(i>-1) state.data.leads[i]=l; else state.data.leads.push(l);
            router();
          }
        });
        main.appendChild(board);
      }
  } else if(route.startsWith('#/outreach')){
    topbarAPI.setActive('#/outreach');
    main.appendChild(createOutreach());
  } else if(route.startsWith('#/agent')){
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

function parseCSV(text){
  const lines=text.trim().split(/\r?\n/);
  if(!lines.length) return [];
  const headers=lines.shift().split(',').map(h=>h.trim());
  return lines.map(line=>{
    const values=line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(v=>v.trim().replace(/^"|"$/g,''));
    const obj={};
    headers.forEach((h,i)=>obj[h]=values[i]||'');
    const id=obj['Listing Number'];
    const address=`${obj['Address']}, ${obj['City']}, ${obj['State']} ${obj['Zip Code']}`;
    const price=obj[' List Price ']||obj['List Price']||'';
    const lat=parseFloat(obj['Latitude']);
    const lng=parseFloat(obj['Longitude']);
    return {id,address,price,lat,lng};
  });
}
