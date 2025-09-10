import { initTopbar } from './components/topbar.js';
// import { initAssistantDrawer } from './components/assistant-drawer.js';
import { initCommandPalette, togglePalette } from './components/command-palette.js';
import { createDataGrid } from './components/datagrid.js';
import { createKanban } from './components/kanban.js';
import { initToast } from './components/toast.js';
import { createAgentChat } from './components/agent-chat.js';
import { openAppointmentForm } from './components/appointment.js';
import { createEventCalendar } from './components/event-calendar.js';

const mapReady = new Promise(resolve => {
  if (window.GOOGLE_MAPS_API_KEY) {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const fallback = document.createElement('script');
      fallback.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      fallback.onload = resolve;
      fallback.onerror = resolve;
      document.head.appendChild(fallback);
    };
    document.head.appendChild(script);
  } else {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  }
});
window.mapReady = mapReady;

const state={ data:{}, gmap:null, markers:{}, activeMarkerId:null };
let topbarAPI;
let agentChatEl;
let googleTokenClient;
const googleTokenListeners=[];

function onGoogleToken(fn){
  googleTokenListeners.push(fn);
}

async function authFetch(url, options = {}) {
  let token;
  try {
    token = (await window.aws_amplify.Auth.currentSession())
      .getIdToken()
      .getJwtToken();
    options.headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    };
  } catch (err) {
    console.warn('No authenticated session; request will be sent without credentials');
  }
  const resp = await fetch(url, options);
  if (resp.status === 401) {
    console.error(`Request to ${url} was unauthorized (401). Ensure you are logged in and the API accepts your token.`);
  }
  return resp;
}

function initGoogleAuth() {
  if (!window.google || !window.google.accounts || !window.GOOGLE_CLIENT_ID) {
    setTimeout(initGoogleAuth, 500);
    return;
  }
  const redirectUri = window.GOOGLE_REDIRECT_URI || window.location.origin;
  googleTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: window.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar',
    redirect_uri: redirectUri,
    callback: async resp => {
      if (resp.access_token) {
        window.GOOGLE_CALENDAR_ACCESS_TOKEN = resp.access_token;
        localStorage.setItem('gcal_token', resp.access_token);
        try {
          await authFetch(`${window.API_BASE_URL}/google-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: resp.access_token })
          });
        } catch {}
        const fns=googleTokenListeners.splice(0);
        if(fns.length){
          fns.forEach(fn=>fn());
        } else {
          router();
        }
      }
    }
  });
}

async function ensureGoogleAccessToken() {
  if (window.GOOGLE_CALENDAR_ACCESS_TOKEN)
    return window.GOOGLE_CALENDAR_ACCESS_TOKEN;
  const stored = localStorage.getItem('gcal_token');
  if (stored) {
    window.GOOGLE_CALENDAR_ACCESS_TOKEN = stored;
    return stored;
  }
  try {
    const resp = await authFetch(`${window.API_BASE_URL}/google-token`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.access_token) {
        window.GOOGLE_CALENDAR_ACCESS_TOKEN = data.access_token;
        localStorage.setItem('gcal_token', data.access_token);
        return data.access_token;
      }
    }
  } catch {}
  return null;
}

function requestGoogleAccessToken() {
  if (googleTokenClient)
    googleTokenClient.requestAccessToken({ prompt: 'consent' });
}

function fetchGoogleCalendarEvents() {
  const token = window.GOOGLE_CALENDAR_ACCESS_TOKEN;
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), 0, 1).toISOString();
  const timeMax = new Date(now.getFullYear() + 1, 0, 1).toISOString();
  if (token) {
    return fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        const calendars = data.items || [];
        return Promise.all(
          calendars.map(cal =>
            fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
                cal.id
              )}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
                timeMin
              )}&timeMax=${encodeURIComponent(timeMax)}`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
              .then(r => r.json())
              .then(d =>
                (d.items || []).map(ev => ({
                  start: ev.start?.dateTime || ev.start?.date,
                  summary: ev.summary
                }))
              )
              .catch(() => [])
          )
        ).then(arrays => arrays.flat());
      })
      .catch(() => []);
  }
  const calendarId = window.GOOGLE_CALENDAR_ID;
  const apiKey = window.GOOGLE_CALENDAR_API_KEY;
  if (!calendarId || !apiKey) return Promise.resolve([]);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events?key=${apiKey}&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
    timeMin
  )}&timeMax=${encodeURIComponent(timeMax)}`;
  return fetch(url)
    .then(r => r.json())
    .then(data => (data.items || []).map(ev => ({
      start: ev.start.dateTime || ev.start.date,
      summary: ev.summary
    })))
    .catch(() => []);
}

// set a static real-estate themed background
const background='global-bg.svg';

function startApp(){
  Promise.all([
    fetch('data/sample.json').then(r=>r.json()),
    fetch('data/listings.csv').then(r=>r.text()),
    mapReady
  ]).then(([d,csv])=>{
    d.properties=parseCSV(csv);
    // Leverages backend API for lead data so remove any bundled sample leads
    d.leads = [];
    state.data=d;
    init();
  });
  initGoogleAuth();
}

startApp();

function init(){
  topbarAPI=initTopbar();
  // initAssistantDrawer();
  initCommandPalette(state.data);
  initToast();
  if(!location.hash) location.hash = '#/sourcing';
  window.addEventListener('hashchange',router);
  router();
  setupShortcuts();
  setupBackground();
}

async function router(){
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
        <label>Listing Number:<input name='listingNumber' required/></label>
        <label>Address:<input name='address' required/></label>
        <label>City:<input name='city'/></label>
        <label>State:<input name='state'/></label>
        <label>Zip Code:<input name='zipCode'/></label>
        <label>Listing Status:<input name='listingStatus'/></label>
        <label>Sale or Rent:<input name='saleOrRent'/></label>
        <label>Property Type:<input name='propertyType'/></label>
        <label>Property Subtype:<input name='propertySubtype'/></label>
        <label>List Price:<input name='listPrice' type='number' step='any' required/></label>
        <label>List Date:<input name='listDate' type='date'/></label>
        <label>Sold Price:<input name='soldPrice' type='number' step='any'/></label>
        <label>Sold Date:<input name='soldDate' type='date'/></label>
        <label>Withdrawn Date:<input name='withdrawnDate' type='date'/></label>
        <label>Expired Date:<input name='expiredDate' type='date'/></label>
        <label>Pending Date:<input name='pendingDate' type='date'/></label>
        <label>REO:<input name='reo' type='checkbox'/></label>
        <label>Short Sale:<input name='shortSale' type='checkbox'/></label>
        <label>Listing Agent Name:<input name='listingAgentName'/></label>
        <label>Listing Office Name:<input name='listingOfficeName'/></label>
        <label>Listing Agent Phone Number:<input name='listingAgentPhone' type='tel'/></label>
        <label>Listing Agent E-Mail Address:<input name='listingAgentEmail' type='email'/></label>
        <label>Sale Agent Name:<input name='saleAgentName'/></label>
        <label>Sale Office Name:<input name='saleOfficeName'/></label>
        <label>County:<input name='county'/></label>
        <label>Parcel ID #:<input name='parcelId'/></label>
        <label>Style:<input name='style'/></label>
        <label>Building/Living Area (sf):<input name='buildingArea' type='number' step='any'/></label>
        <label>PPSF:<input name='ppsf' type='number' step='any'/></label>
        <label>Full Bathrooms:<input name='fullBathrooms' type='number' step='1'/></label>
        <label>Half Bathrooms:<input name='halfBathrooms' type='number' step='1'/></label>
        <label>Bedrooms:<input name='bedrooms' type='number' step='1'/></label>
        <label>Year Built:<input name='yearBuilt' type='number' step='1'/></label>
        <label>Pool:<input name='pool' type='checkbox'/></label>
        <label>Garage:<input name='garage' type='checkbox'/></label>
        <label>Parking Total:<input name='parkingTotal' type='number' step='1'/></label>
        <label>Lot Size (sf):<input name='lotSizeSf' type='number' step='any'/></label>
        <label>Lot Size (acres):<input name='lotSizeAcres' type='number' step='any'/></label>
        <label>Subdivision:<input name='subdivision'/></label>
        <label>Development Name:<input name='developmentName'/></label>
        <label>Zoning:<input name='zoning'/></label>
        <label>Waterfront:<input name='waterfront' type='checkbox'/></label>
        <label>Property SqFt:<input name='propertySqFt' type='number' step='any'/></label>
        <label>Elementary School:<input name='elementarySchool'/></label>
        <label>Middle School:<input name='middleSchool'/></label>
        <label>High School:<input name='highSchool'/></label>
        <label>Net Operating Income:<input name='netOperatingIncome' type='number' step='any'/></label>
        <label>Gross Operating Income:<input name='grossOperatingIncome' type='number' step='any'/></label>
        <label>Last Sale Date (Tax Records):<input name='lastSaleDate' type='date'/></label>
        <label>Owner Name 1:<input name='ownerName1'/></label>
        <label>Owner Name 2:<input name='ownerName2'/></label>
        <label>Owner Address:<input name='ownerAddress'/></label>
        <label>Owner City:<input name='ownerCity'/></label>
        <label>Owner State:<input name='ownerState'/></label>
        <label>Owner Zip Code:<input name='ownerZipCode'/></label>
        <label>Owner County:<input name='ownerCounty'/></label>
        <label>Owner Occupied:<input name='ownerOccupied' type='checkbox'/></label>
        <label>MLS Area:<input name='mlsArea'/></label>
        <label>Longitude:<input name='longitude' type='number' step='any' required/></label>
        <label>Latitude:<input name='latitude' type='number' step='any' required/></label>
        <div class='form-actions'>
          <button type='submit'>Save</button>
          <button type='button' id='cancelProperty'>Cancel</button>
        </div>`;
      const close=()=>overlay.remove();
      overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
      form.addEventListener('submit',e=>{
        e.preventDefault();
        if(!form.reportValidity()) return;
        const fd=new FormData(form);
        const obj=Object.fromEntries(fd.entries());
        obj.reo=form.reo.checked;
        obj.shortSale=form.shortSale.checked;
        obj.pool=form.pool.checked;
        obj.garage=form.garage.checked;
        obj.waterfront=form.waterfront.checked;
        obj.ownerOccupied=form.ownerOccupied.checked;
        ['listPrice','soldPrice','buildingArea','ppsf','fullBathrooms','halfBathrooms','bedrooms','yearBuilt','parkingTotal','lotSizeSf','lotSizeAcres','propertySqFt','netOperatingIncome','grossOperatingIncome','latitude','longitude'].forEach(f=>{ if(obj[f]) obj[f]=parseFloat(obj[f]); });
        const id=Date.now();
        const property={id,...obj,lat:obj.latitude,lng:obj.longitude,price:obj.listPrice,year:obj.yearBuilt,beds:obj.bedrooms,baths:(obj.fullBathrooms||0)+0.5*(obj.halfBathrooms||0)};
        state.data.properties=state.data.properties||[];
        state.data.properties.push(property);
        close();
        router();
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

      if(window.google && state.gmap instanceof google.maps.Map){
        state.gmap.setCenter({lat,lng});
        state.gmap.setZoom(16);
        if(state.activeMarkerId && state.markers[state.activeMarkerId]){
          const prev=state.markers[state.activeMarkerId];
          if(state.defaultIcon) prev.setIcon(state.defaultIcon);
          if(prev.infoWindow) prev.infoWindow.close();
        }
        const marker=state.markers[p.id];
        if(marker){
          marker.setIcon(state.activeIcon);
          if(marker.infoWindow) marker.infoWindow.open(state.gmap,marker);
          state.activeMarkerId=p.id;
        }
      } else {
        state.gmap.setView([lat,lng],16);
        if(state.activeMarkerId && state.markers[state.activeMarkerId]){
          const prev=state.markers[state.activeMarkerId];
          if(state.defaultIcon && prev.setIcon) prev.setIcon(state.defaultIcon);
        }
        const marker=state.markers[p.id];
        if(marker){
          marker.openPopup();
          if(state.activeIcon && marker.setIcon) marker.setIcon(state.activeIcon);
          const popup=marker.getPopup();
          if(popup){
            const el=popup.getElement();
            if(el){
              const btn=el.querySelector('.add-lead');
              if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
              const view=el.querySelector('.view-details');
              if(view) view.onclick=()=>{location.hash=`#/property?prop=${p.id}`;};
            }
          }
          state.activeMarkerId=p.id;
        }
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
          let filtered=props.filter(p=>(`${p.address} ${p.city||''}`).toLowerCase().includes(term));
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
    state.markers={};
    const center=props.length?{lat:Number(props[0].lat),lng:Number(props[0].lng)}:{lat:39.5,lng:-98.35};
    const zoom=props.length?10:5;
    if(window.google && window.google.maps){
      state.gmap=new google.maps.Map(map,{center,zoom,streetViewControl:true});
      state.defaultIcon=state.defaultIcon||'https://maps.google.com/mapfiles/ms/icons/blue-dot.png';
      state.activeIcon=state.activeIcon||'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
      const bounds=new google.maps.LatLngBounds();
      props.forEach(p=>{
        const lat=Number(p.lat), lng=Number(p.lng);
        if(!isNaN(lat)&&!isNaN(lng)){
          const position={lat,lng};
          const details=[
            p.listingNumber?`Listing #${p.listingNumber}`:'',
            p.beds?`${p.beds} bd`:'',
            p.baths?`${p.baths} ba`:'',
            p.year?`Built ${p.year}`:'',
            p.status||'',
            p.type||'',
            p.saleOrRent||''
          ].filter(Boolean).join(' | ');
          const fullAddress=p.city?`${p.address}, ${p.city}`:p.address;
          const imgSrc=(window.GOOGLE_MAPS_API_KEY&&!isNaN(lat)&&!isNaN(lng))?`https://maps.googleapis.com/maps/api/streetview?size=200x120&location=${lat},${lng}&key=${window.GOOGLE_MAPS_API_KEY}`:(p.image||'');
          const content=document.createElement('div');
          content.innerHTML=`${imgSrc?`<img src="${imgSrc}" alt="Property image" style="max-width:200px"/><br/>`:''}${fullAddress}<br/>${p.price}${details?`<br/>${details}`:''}<br/><button class='add-lead'>Add to Leads</button> <button class='view-details'>View Details</button>`;
          const marker=new google.maps.Marker({position,map:state.gmap,icon:state.defaultIcon});
          marker.infoWindow=new google.maps.InfoWindow({content});
          content.querySelector('.add-lead')?.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
          content.querySelector('.view-details')?.addEventListener('click',()=>{location.hash=`#/property?prop=${p.id}`;});
          marker.addListener('click',()=>selectProperty(p.id));
          bounds.extend(position);
          state.markers[p.id]=marker;
        }
      });
      if(props.length>1){state.gmap.fitBounds(bounds);}
    } else if(window.L){
      state.gmap=L.map(map).setView([center.lat,center.lng],zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(state.gmap);
      state.defaultIcon=state.defaultIcon||L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
      state.activeIcon=state.activeIcon||L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
      const bounds=L.latLngBounds();
      props.forEach(p=>{
        const lat=Number(p.lat), lng=Number(p.lng);
        if(!isNaN(lat)&&!isNaN(lng)){
          const position=[lat,lng];
          const details=[
            p.listingNumber?`Listing #${p.listingNumber}`:'',
            p.beds?`${p.beds} bd`:'',
            p.baths?`${p.baths} ba`:'',
            p.year?`Built ${p.year}`:'',
            p.status||'',
            p.type||'',
            p.saleOrRent||''
          ].filter(Boolean).join(' | ');
          const fullAddress=p.city?`${p.address}, ${p.city}`:p.address;
          const imgSrc=(window.GOOGLE_MAPS_API_KEY&&!isNaN(lat)&&!isNaN(lng))?`https://maps.googleapis.com/maps/api/streetview?size=200x120&location=${lat},${lng}&key=${window.GOOGLE_MAPS_API_KEY}`:(p.image||'');
          const marker=L.marker(position,{icon:state.defaultIcon}).addTo(state.gmap).bindPopup(`<div>${imgSrc?`<img src="${imgSrc}" alt="Property image" style="max-width:200px"/><br/>`:''}${fullAddress}<br/>${p.price}${details?`<br/>${details}`:''}<br/><button class='add-lead'>Add to Leads</button> <button class='view-details'>View Details</button></div>`);
          state.markers[p.id]=marker;
          bounds.extend(position);
          marker.on('click',()=>selectProperty(p.id));
          marker.on('popupopen',e=>{
            const el=e.popup.getElement();
            if(!el) return;
            const btn=el.querySelector('.add-lead');
            if(btn) btn.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
            const view=el.querySelector('.view-details');
            if(view) view.addEventListener('click',()=>{location.hash=`#/property?prop=${p.id}`;});
          });
        }
      });
      if(props.length>1){state.gmap.fitBounds(bounds);}
    } else {
      map.textContent='Loading map…';
      return;
    }
    if(initialProp){ selectProperty(initialProp); }
    } else if(route.startsWith('#/property')){
      topbarAPI.setActive('#/sourcing');
      const params=new URLSearchParams(query||'');
      const propId=params.get('prop');
      const p=(state.data.properties||[]).find(x=>String(x.id)===String(propId));
      if(p){
        const wrap=document.createElement('div');
        wrap.className='property-view';
        const fullAddress=p.city?`${p.address}, ${p.city}`:p.address;
        wrap.innerHTML=`<h2>${fullAddress}</h2>`+
          `<p>Price: ${p.price||''}</p>`+
          `<p>${p.beds?`${p.beds} bd`:''} ${p.baths?`${p.baths} ba`:''}</p>`+
          `<p>${p.year?`Built ${p.year}`:''}</p>`+
          `<p>${p.status||''} ${p.type?`| ${p.type}`:''} ${p.saleOrRent?`| ${p.saleOrRent}`:''}</p>`;
        const actions=document.createElement('div');
        const leadBtn=document.createElement('button');
        leadBtn.textContent='Add to Leads';
        leadBtn.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
        const apptBtn=document.createElement('button');
        apptBtn.textContent='Book Appointment';
        apptBtn.addEventListener('click',()=>openAppointmentForm(p));
        actions.append(leadBtn,apptBtn);
        wrap.appendChild(actions);
        main.appendChild(wrap);
      } else {
        const msg=document.createElement('p');
        msg.textContent='Property not found';
        main.appendChild(msg);
      }
    } else if(route.startsWith('#/leads')){
      topbarAPI.setActive('#/leads');
      let resp;
      try{
        resp=await authFetch(`${window.API_BASE_URL}/leads`);
      } catch(err){
        console.error('Error fetching leads',err);
      }
      if(resp && resp.status===401){
        const msg=document.createElement('p');
        msg.className='error';
        msg.textContent='Unable to load leads: authentication required. Sign in and try again.';
        main.appendChild(msg);
        return;
      }
      state.data.leads = resp && resp.ok ? await resp.json() : [];
      let board;
      const layout=document.createElement('div');
      layout.className='leads-page';

      function openLeadForm(lead=null, property=null){
        const overlay=document.createElement('div');
        overlay.className='modal';
        const form=document.createElement('form');
        form.className='lead-form';
        const isEdit=!!lead;
        const fullAddress=property? (property.city?`${property.address}, ${property.city}`:property.address):'';
        form.innerHTML=`<h2>${isEdit?`Edit Lead${lead.property?` for ${lead.property}`:''}`:`Add Lead${property?` for ${fullAddress}`:''}`}</h2>`+
          `<label>Listing Number:<input name='listing' ${(lead&&lead.listingNumber)?`value='${lead.listingNumber}'`:(property?`value='${property.listingNumber||''}'`:'')} required/></label>`+
          `<label>Name:<input name='name' ${(lead&&lead.name)?`value='${lead.name}'`:''} required/></label>`+
          `<label>Email:<input name='email' type='email' ${(lead&&lead.email)?`value='${lead.email}'`:''}/></label>`+
          `<label>Phone:<input name='phone' ${(lead&&lead.phone)?`value='${lead.phone}'`:''}/></label>`+
          `<label>Address:<input name='address' ${(lead&&lead.address)?`value='${lead.address}'`:''}/></label>`+
          `<label>Notes:<textarea name='notes'>${(lead&&lead.notes)||''}</textarea></label>`+
          `<div class='form-actions'>`+
            `<button type='submit'>Save</button>`+
            `<button type='button' id='cancelLead'>Cancel</button>`+
          `</div>`;
        const close=()=>overlay.remove();
        overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
        form.addEventListener('submit',e=>{
          e.preventDefault();
          const listing=form.listing.value.trim();
          const name=form.name.value.trim();
          const email=form.email.value.trim();
          const phone=form.phone.value.trim();
          const address=form.address.value.trim();
          const notes=form.notes.value.trim();
          if(!name||!listing) return;
          const payload={listingNumber:listing,name,email,phone,address,notes,property:property?fullAddress:(lead?lead.property:'')};
          if(isEdit){
            authFetch(`${window.API_BASE_URL}/leads/${lead.id}`,{
              method:'PUT',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(payload)
            }).then(()=>{
              const i=state.data.leads.findIndex(x=>x.id===lead.id);
              if(i>-1) state.data.leads[i]={...state.data.leads[i],...payload};
              close();
              board.render();
            });
          } else {
            authFetch(`${window.API_BASE_URL}/leads`,{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(payload)
            }).then(r=>r.json()).then(data=>{
              state.data.leads=state.data.leads||[];
              state.data.leads.push({id:data.id,stage:'New',...payload});
              close();
              board.render();
            });
          }
        });
        form.querySelector('#cancelLead').addEventListener('click',close);
        overlay.appendChild(form);
        document.body.appendChild(overlay);
      }

      board=createKanban(state.data.leads||[],{
        onAdd:()=>openLeadForm(),
        onEdit:l=>{
          authFetch(`${window.API_BASE_URL}/leads/${l.id}`,{
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(l)
          }).then(()=>{
            const i=state.data.leads.findIndex(x=>x.id===l.id);
            if(i>-1) state.data.leads[i]={...state.data.leads[i],...l}; else state.data.leads.push(l);
            board.render();
          });
        },
        onOpen:lead=>openLeadForm(lead),
        onDelete:l=>{
          authFetch(`${window.API_BASE_URL}/leads/${l.id}`,{method:'DELETE'}).then(()=>{
            const i=state.data.leads.findIndex(x=>x.id===l.id);
            if(i>-1) state.data.leads.splice(i,1);
            board.render();
          });
        }
      });
      layout.appendChild(board.el);
      const calendarWrap=document.createElement('div');
      calendarWrap.className='leads-calendar';
      calendarWrap.innerHTML='<h3>Calendar</h3>';
      const syncBtn=document.createElement('button');
      syncBtn.textContent='Sync Google Calendar';
      const unlinkBtn=document.createElement('button');
      unlinkBtn.textContent='Unlink Google Calendar';
      unlinkBtn.style.display='none';
      let calendarEl=createEventCalendar();
      function renderCalendar(){
        fetchGoogleCalendarEvents().then(events=>{
          const newEl=createEventCalendar(events);
          calendarEl.replaceWith(newEl);
          calendarEl=newEl;
        });
        syncBtn.style.display='none';
        unlinkBtn.style.display='';
      }
      syncBtn.addEventListener('click',()=>{
        onGoogleToken(renderCalendar);
        requestGoogleAccessToken();
      });
      unlinkBtn.addEventListener('click',()=>{
        const token=window.GOOGLE_CALENDAR_ACCESS_TOKEN;
        if(token){
          fetch(`https://oauth2.googleapis.com/revoke?token=${token}`,{method:'POST'}).catch(()=>{});
        }
        authFetch(`${window.API_BASE_URL}/google-token`,{method:'DELETE'}).catch(()=>{});
        delete window.GOOGLE_CALENDAR_ACCESS_TOKEN;
        localStorage.removeItem('gcal_token');
        const newEl=createEventCalendar();
        calendarEl.replaceWith(newEl);
        calendarEl=newEl;
        syncBtn.style.display='';
        unlinkBtn.style.display='none';
      });
      calendarWrap.append(syncBtn,unlinkBtn,calendarEl);
      layout.appendChild(calendarWrap);
      main.appendChild(layout);

      ensureGoogleAccessToken().then(token=>{
        if(token){
          renderCalendar();
        }
      });

      const params=new URLSearchParams(query||'');
      const propId=params.get('prop');
      if(propId){
        const p=(state.data.properties||[]).find(x=>String(x.id)===String(propId));
        if(p){
          openLeadForm(null,p);
          if(history.replaceState){ history.replaceState(null,'','#/leads'); }
        }
      }
  } else if(route.startsWith('#/outreach')){
    topbarAPI.setActive('#/outreach');
    main.appendChild(createOutreach());
  } else if(route.startsWith('#/emails')){
    topbarAPI.setActive('#/emails');
    main.appendChild(createEmailsView());
  } else if(route.startsWith('#/agent')){
    topbarAPI.setActive('#/agent');
    if(!agentChatEl) agentChatEl=createAgentChat();
    main.appendChild(agentChatEl);
    const msgs = agentChatEl.querySelector('#chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
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

function createEmailsView(){
  const wrap=document.createElement('div');
  wrap.className='emails-view';
  const controls=document.createElement('div');
  const gmailForm=document.createElement('form');
  gmailForm.className='sync-form gmail-sync';
  gmailForm.innerHTML=`<input name="username" type="email" placeholder="Gmail address" required>
    <input name="password" type="password" placeholder="App password" required>
    <button type="submit">Sync Gmail</button>`;

  const outlookForm=document.createElement('form');
  outlookForm.className='sync-form outlook-sync';
  outlookForm.innerHTML=`<input name="username" type="email" placeholder="Outlook address" required>
    <input name="password" type="password" placeholder="App password" required>
    <button type="submit">Sync Outlook</button>`;

  controls.append(gmailForm,outlookForm);
  const list=document.createElement('div'); list.id='email-list';
  const form=document.createElement('form');
  form.innerHTML=`<h3>Send Email</h3>
    <label>Provider<select name="provider"><option value="gmail">Gmail</option><option value="outlook">Outlook</option></select></label>
    <label>To<input name="to" type="email" required></label>
    <label>Subject<input name="subject" required></label>
    <label>Body<textarea name="body" required></textarea></label>
    <button type="submit">Send</button>`;
  wrap.append(controls,list,form);

  async function render(provider){
    const resp=await authFetch(`${window.API_BASE_URL}/emails/${provider}`);
    if(!resp.ok) return;
    const data=await resp.json();
    list.innerHTML='';
    (data.messages||[]).forEach(m=>{
      const item=document.createElement('div');
      item.className='email-item';
      item.textContent=`${m.subject} - ${m.sender}`;
      item.addEventListener('click',()=>item.classList.toggle('read'));
      const cat=document.createElement('input');
      cat.placeholder='Category';
      item.appendChild(cat);
      list.appendChild(item);
    });
  }

  gmailForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(gmailForm);
    const username=fd.get('username');
    const password=fd.get('password');
    if(!username||!password) return;
    await authFetch(`${window.API_BASE_URL}/emails/gmail/sync`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    render('gmail');
  });

  outlookForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(outlookForm);
    const username=fd.get('username');
    const password=fd.get('password');
    if(!username||!password) return;
    await authFetch(`${window.API_BASE_URL}/emails/outlook/sync`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    render('outlook');
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(form);
    const provider=fd.get('provider');
    const to=fd.get('to');
    const subject=fd.get('subject');
    const body=fd.get('body');
    const resp=await authFetch(`${window.API_BASE_URL}/emails/${provider}/send`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({to,subject,body})
    });
    if(resp.ok) alert('Email sent');
  });

  return wrap;
}

function setupShortcuts(){
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); togglePalette(); }
  });
}

function setupBackground(){
  const bg=document.getElementById('bg');
  if(!bg) return;
  bg.style.backgroundImage=`url('${background}')`;
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
