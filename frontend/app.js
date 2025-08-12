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

const state={ data:{}, gmap:null, markers:{}, infoWin:null, activeMarkerId:null };
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
  const searchInput=document.getElementById('global-search');
  if(searchInput){ searchInput.oninput=null; searchInput.value=''; }
  if(route.startsWith('#/sourcing')){
    topbarAPI.setActive('#/sourcing');
    const wrap=document.createElement('div');
    wrap.className='sourcing-view';
    const map=document.createElement('div');map.id='map';
    const addBtn=document.createElement('button');
    addBtn.textContent='Add Property';
    addBtn.addEventListener('click',()=>{
      const overlay=document.createElement('div');
      overlay.className='modal';
      const form=document.createElement('form');
      form.className='property-form';
      form.innerHTML=`<h2>Add Property</h2>
        <label>Address:<input name='address' required/></label>
        <label>Price:<input name='price' required/></label>
        <label>Latitude:<input name='lat' type='number' step='any' required/></label>
        <label>Longitude:<input name='lng' type='number' step='any' required/></label>
        <div class='form-actions'>
          <button type='submit'>Save</button>
          <button type='button' id='cancelProperty'>Cancel</button>
        </div>`;
      const close=()=>overlay.remove();
      overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
      form.addEventListener('submit',e=>{
        e.preventDefault();
        const address=form.address.value.trim();
        const price=form.price.value.trim();
        const lat=parseFloat(form.lat.value);
        const lng=parseFloat(form.lng.value);
        if(address&&price&&!isNaN(lat)&&!isNaN(lng)){
          const id=Date.now();
          state.data.properties=state.data.properties||[];
          state.data.properties.push({id,address,price,lat,lng});
          close();
          router();
        }
      });
      form.querySelector('#cancelProperty').addEventListener('click',()=>{close();});
      overlay.appendChild(form);
      document.body.appendChild(overlay);
    });
    const props=state.data.properties||[];
    const params=new URLSearchParams(query||'');
    const initialProp=params.get('prop');
    function selectProperty(id){
      if(!state.gmap) return;
      const p=(state.data.properties||[]).find(x=>String(x.id)===String(id));
      if(!p) return;
      const lat=Number(p.lat), lng=Number(p.lng);
      if(isNaN(lat)||isNaN(lng)) return;

      // Center map on selection
      if(window.google?.maps){
        state.gmap.panTo({lat,lng});
        state.gmap.setZoom(16);
      } else if(window.L){
        state.gmap.setView([lat,lng],16);
      }

      // Reset previous marker highlight
      if(state.activeMarkerId && state.markers[state.activeMarkerId]){
        const prev=state.markers[state.activeMarkerId];
        if(window.google?.maps){
          if(prev.setIcon) prev.setIcon(null);
        } else if(window.L){
          if(state.defaultIcon && prev.setIcon) prev.setIcon(state.defaultIcon);
        }
      }

      const marker=state.markers[p.id];
      if(marker){
        if(window.google?.maps){
          const details=[
            p.beds?`${p.beds} bd`:'',
            p.baths?`${p.baths} ba`:'',
            p.year?`Built ${p.year}`:'',
            p.status||'',
            p.type||'',
            p.saleOrRent||''
          ].filter(Boolean).join(' | ');
          state.infoWin.setContent(`<div>${p.address}<br/>${p.price}${details?`<br/>${details}`:''}<br/><button id="addLead">Add to Leads</button></div>`);
          state.infoWin.addListener('domready',()=>{
            const btn=document.getElementById('addLead');
            if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
          });
          if(google.maps.marker?.AdvancedMarkerElement && marker instanceof google.maps.marker.AdvancedMarkerElement){
            state.infoWin.open({map:state.gmap,anchor:marker});
          } else {
            state.infoWin.open(state.gmap,marker);
            if(marker.setIcon) marker.setIcon('http://maps.google.com/mapfiles/ms/icons/blue-dot.png');
            if(marker.getAnimation){
              marker.setAnimation(google.maps.Animation.BOUNCE);
              setTimeout(()=>marker.setAnimation(null),700);
            }
          }
        } else if(window.L){
          marker.openPopup();
          if(state.activeIcon && marker.setIcon) marker.setIcon(state.activeIcon);
          const popup=marker.getPopup();
          if(popup){
            const el=popup.getElement();
            if(el){
              const btn=el.querySelector('.add-lead');
              if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
            }
          }
        }
        state.activeMarkerId=p.id;
      }

      document.querySelectorAll('#grid tr.active').forEach(r=>r.classList.remove('active'));
      const row=document.querySelector(`#grid tr[data-prop-id='${p.id}']`);
      if(row){
        row.classList.add('active');
        row.scrollIntoView({behavior:'smooth',block:'center'});
      }
    }
    const grid=createDataGrid(props,selectProperty);
    wrap.append(map,addBtn,grid.el);
    // Filter and sort listings based on topbar controls
    const sortSelect=document.getElementById('sort-select');
    const filterSelect=document.getElementById('filter-select');
    if(searchInput||sortSelect||filterSelect){
      const apply=()=>{
        const term=searchInput?searchInput.value.toLowerCase():'';
        const filter=filterSelect?filterSelect.value:'all';
        let filtered=props.filter(p=>p.address.toLowerCase().includes(term));
        if(filter==='sale') filtered=filtered.filter(p=>String(p.saleOrRent).toLowerCase().includes('sale'));
        else if(filter==='rent') filtered=filtered.filter(p=>String(p.saleOrRent).toLowerCase().includes('rent'));
        if(sortSelect&&sortSelect.value){
          const [key,dir]=sortSelect.value.split('-');
          grid.setSort(key,dir==='asc');
        } else {
          grid.setSort(null,true);
        }
        grid.update(filtered);
      };
      if(searchInput) searchInput.addEventListener('input',apply);
      if(sortSelect) sortSelect.addEventListener('change',apply);
      if(filterSelect) filterSelect.addEventListener('change',apply);
      apply();
    }
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
      state.defaultIcon=state.defaultIcon||L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
      state.activeIcon=state.activeIcon||L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x-green.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
      const bounds=L.latLngBounds();
      props.forEach(p=>{
        const lat=Number(p.lat), lng=Number(p.lng);
        if(!isNaN(lat)&&!isNaN(lng)){
          const position=[lat,lng];
          const details=[
            p.beds?`${p.beds} bd`:'',
            p.baths?`${p.baths} ba`:'',
            p.year?`Built ${p.year}`:'',
            p.status||'',
            p.type||'',
            p.saleOrRent||''
          ].filter(Boolean).join(' | ');
          const marker=L.marker(position,{icon:state.defaultIcon}).addTo(state.gmap).bindPopup(`<div>${p.address}<br/>${p.price}${details?`<br/>${details}`:''}<br/><button class='add-lead'>Add to Leads</button></div>`);
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
    if(initialProp){ selectProperty(initialProp); }
    } else if(route.startsWith('#/leads')){
      topbarAPI.setActive('#/leads');
      const board=createKanban(state.data.leads||[],{
        onAdd:()=>{location.hash='#/leads?new=1';},
        onEdit:l=>{
          const i=state.data.leads.findIndex(x=>x.id===l.id);
          if(i>-1) state.data.leads[i]=l; else state.data.leads.push(l);
          router();
        }
      });
      main.appendChild(board);

      const params=new URLSearchParams(query||'');
      const propId=params.get('prop');
      const isNew=params.has('new');
      if(propId || isNew){
        const p=propId?(state.data.properties||[]).find(x=>String(x.id)===String(propId)):null;
        const overlay=document.createElement('div');
        overlay.className='modal';
        const form=document.createElement('form');
        form.className='lead-form';
        form.innerHTML=`<h2>Add Lead${p?` for ${p.address}`:''}</h2>
          <label>Name:<input name='name' required/></label>
          <label>Email:<input name='email' type='email'/></label>
          <label>Phone:<input name='phone'/></label>
          <div class='form-actions'>
            <button type='submit'>Save</button>
            <button type='button' id='cancelLead'>Cancel</button>
          </div>`;
        const close=()=>{ overlay.remove(); location.hash='#/leads'; };
        overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
        form.addEventListener('submit',e=>{
          e.preventDefault();
          const name=form.name.value.trim();
          const email=form.email.value.trim();
          const phone=form.phone.value.trim();
          if(!name) return;
          state.data.leads=state.data.leads||[];
          state.data.leads.push({id:Date.now(),name,email,phone,stage:'New',property:p?p.address:''});
          close();
        });
        form.querySelector('#cancelLead').addEventListener('click',close);
        overlay.appendChild(form);
        document.body.appendChild(overlay);
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
    const beds=obj['Bedrooms'];
    const fullBaths=parseFloat(obj['Full Bathrooms'])||0;
    const halfBaths=parseFloat(obj['Half Bathrooms'])||0;
    const bathsVal=fullBaths+halfBaths*0.5;
    const baths=bathsVal||'';
    const year=obj['Year Built'];
    const status=obj['Listing Status'];
    const saleOrRent=obj['Sale or Rent'];
    const type=obj['Property Type']||obj['Property Subtype'];
    return {id,address,price,lat,lng,beds,baths,year,status,saleOrRent,type};
  });
}
