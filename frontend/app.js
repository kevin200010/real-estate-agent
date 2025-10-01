import { initTopbar } from './components/topbar.js';
// import { initAssistantDrawer } from './components/assistant-drawer.js';
import { initCommandPalette, togglePalette } from './components/command-palette.js';
import { createDataGrid } from './components/datagrid.js';
import { createKanban } from './components/kanban.js';
import { initToast, showToast } from './components/toast.js';
import { openAppointmentForm } from './components/appointment.js';
import { createEventCalendar } from './components/event-calendar.js';
import { createEmailsView } from './components/email.js';
import { createAgentChat } from './components/agent-chat.js';

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
let agentView;
let topbarAPI;
let emailsEl;
let googleTokenClient;
const googleTokenListeners=[];
let gmailTokenClient;
const gmailTokenListeners=[];
let gmailAccount={ email:null, expiresAt:null, scope:null, tokenType:null };
let propertyDetailOverlay=null;
let propertyDetailEscapeHandler=null;
const propertyIntelCache=new Map();

function onGoogleToken(fn){
  googleTokenListeners.push(fn);
}

function onGmailToken(fn){
  if(typeof fn==='function'){
    gmailTokenListeners.push({ type:'listener', handler:fn });
  }
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

const pendingPropertyUpdates = new Set();

function normaliseProperties(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map(item => ({
    ...item,
    inSystem: item?.inSystem !== false
  }));
}

function mergeProperty(record) {
  if (!record) return;
  const props = Array.isArray(state.data.properties) ? [...state.data.properties] : [];
  const idx = props.findIndex(p => String(p.id) === String(record.id));
  if (idx >= 0) props[idx] = { ...props[idx], ...record };
  else props.push(record);
  state.data.properties = normaliseProperties(props);
}

function refreshSourcingView(focusId) {
  const baseRoute = '#/sourcing';
  if (!location.hash.startsWith(baseRoute)) return;
  if (focusId) {
    const nextHash = `${baseRoute}?prop=${focusId}`;
    if (history.replaceState) history.replaceState(null, '', nextHash);
    else location.hash = nextHash;
  }
  router();
}

async function markPropertyStatus(propertyId, inSystem) {
  if (!window.API_BASE_URL) {
    showToast('API base URL is not configured');
    return;
  }
  if (pendingPropertyUpdates.has(propertyId)) return;
  pendingPropertyUpdates.add(propertyId);
  const endpoint = inSystem ? 'restore' : 'remove';
  try {
    const resp = await authFetch(`${window.API_BASE_URL}/properties/${propertyId}/${endpoint}`, { method: 'POST' });
    if (!resp.ok) {
      let message = `Request failed (${resp.status})`;
      try {
        const detail = await resp.json();
        if (detail && typeof detail === 'object' && detail.detail) message = detail.detail;
      } catch (err) {
        console.warn('Failed to parse property update error', err);
      }
      throw new Error(message);
    }
    const updated = await resp.json();
    mergeProperty(updated);
    showToast(inSystem ? 'Listing restored to system' : 'Listing marked as out of system');
    refreshSourcingView(updated.id);
  } catch (err) {
    console.error('Failed to update property status', err);
    showToast(err?.message || 'Failed to update property');
  } finally {
    pendingPropertyUpdates.delete(propertyId);
  }
}

function closePropertyDetail() {
  if (!propertyDetailOverlay) return;
  if (propertyDetailEscapeHandler) {
    window.removeEventListener('keydown', propertyDetailEscapeHandler);
    propertyDetailEscapeHandler = null;
  }
  propertyDetailOverlay.remove();
  propertyDetailOverlay = null;
  document.body.classList.remove('property-detail-open');
}

function derivePropertyImage(property) {
  if (!property) return '';
  if (property.image) return property.image;
  const lat = Number(property.lat);
  const lng = Number(property.lng);
  if (window.GOOGLE_MAPS_API_KEY && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `https://maps.googleapis.com/maps/api/streetview?size=640x420&location=${lat},${lng}&key=${window.GOOGLE_MAPS_API_KEY}`;
  }
  return '';
}

function formatDetailValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(item => formatDetailValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      console.warn('Failed to stringify metadata value', err);
      return '';
    }
  }
  return String(value);
}

function createDetailRow(container, label, value) {
  if (!container) return;
  const display = formatDetailValue(value);
  if (!display) return;
  const row = document.createElement('div');
  row.className = 'property-detail-row';
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = display;
  row.append(term, detail);
  container.appendChild(row);
}

function applyPropertySnapshot(snapshot, nodes) {
  if (!snapshot || !nodes?.panel?.isConnected) return;
  const {
    labelEl,
    titleEl,
    sublineEl,
    badgeEl,
    heroEl,
    heroImg,
    statsList,
    infoList,
    locationList,
    metadataList,
    metadataEmpty,
    systemCopy,
    toggleBtn,
  } = nodes;

  if (labelEl) labelEl.textContent = snapshot.inSystem ? 'Active listing' : 'Removed listing';
  if (titleEl) titleEl.textContent = snapshot.address || 'Property';

  if (sublineEl) {
    const locality = [snapshot.city, snapshot.state].filter(Boolean).join(', ');
    const zip = snapshot.zipCode ? String(snapshot.zipCode).trim() : '';
    sublineEl.textContent = zip ? `${locality ? `${locality} ` : ''}${zip}`.trim() : locality;
  }

  if (badgeEl) {
    badgeEl.textContent = snapshot.inSystem ? 'In System' : 'Not in System';
    if (snapshot.inSystem) badgeEl.classList.remove('removed');
    else badgeEl.classList.add('removed');
  }

  if (systemCopy) {
    systemCopy.textContent = snapshot.inSystem
      ? 'This property is currently tracked in your sourcing workspace.'
      : 'This property is marked as out of system.';
  }

  if (toggleBtn) {
    toggleBtn.disabled = false;
    toggleBtn.textContent = snapshot.inSystem ? 'Mark Out of System' : 'Restore Listing';
  }

  if (heroEl && heroImg) {
    const heroSrc = derivePropertyImage(snapshot);
    if (heroSrc) {
      heroImg.src = heroSrc;
      heroEl.classList.remove('empty');
    } else {
      heroImg.removeAttribute('src');
      heroEl.classList.add('empty');
    }
  }

  if (statsList) {
    statsList.innerHTML = '';
    const metrics = [
      { label: 'Price', value: snapshot.price || '—' },
      { label: 'Beds', value: snapshot.beds ?? '—' },
      { label: 'Baths', value: snapshot.baths ?? '—' },
      { label: 'Year Built', value: snapshot.year ?? '—' },
      { label: 'Status', value: snapshot.status || '—' },
      { label: 'Sale / Rent', value: snapshot.saleOrRent || '—' },
      { label: 'Type', value: snapshot.type || '—' },
      { label: 'Listing #', value: snapshot.listingNumber || '—' },
      { label: 'System', value: snapshot.inSystem ? 'In System' : 'Not in System' },
    ];
    if (snapshot.removedAt) {
      try {
        const removedDate = new Date(snapshot.removedAt);
        metrics.push({ label: 'Removed At', value: removedDate.toLocaleString() });
      } catch (err) {
        metrics.push({ label: 'Removed At', value: snapshot.removedAt });
      }
    }
    metrics.forEach(item => {
      const li = document.createElement('li');
      li.className = 'property-stat';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'label';
      labelSpan.textContent = item.label;
      const valueSpan = document.createElement('span');
      valueSpan.className = 'value';
      valueSpan.textContent = formatDetailValue(item.value) || '—';
      li.append(labelSpan, valueSpan);
      statsList.appendChild(li);
    });
  }

  if (infoList) {
    infoList.innerHTML = '';
    createDetailRow(infoList, 'Listing Number', snapshot.listingNumber);
    createDetailRow(infoList, 'Status', snapshot.status);
    createDetailRow(infoList, 'Sale / Rent', snapshot.saleOrRent);
    createDetailRow(infoList, 'Property Type', snapshot.type);
    createDetailRow(infoList, 'Beds', snapshot.beds);
    createDetailRow(infoList, 'Baths', snapshot.baths);
    createDetailRow(infoList, 'Year Built', snapshot.year);
    createDetailRow(infoList, 'Price', snapshot.price);
    if (snapshot.removedAt) createDetailRow(infoList, 'Removed At', snapshot.removedAt);
  }

  if (locationList) {
    locationList.innerHTML = '';
    createDetailRow(locationList, 'Address', snapshot.address);
    createDetailRow(locationList, 'City', snapshot.city);
    createDetailRow(locationList, 'State', snapshot.state);
    createDetailRow(locationList, 'Postal Code', snapshot.zipCode);
    const lat = Number(snapshot.lat);
    if (!Number.isNaN(lat)) createDetailRow(locationList, 'Latitude', lat.toFixed(6));
    const lng = Number(snapshot.lng);
    if (!Number.isNaN(lng)) createDetailRow(locationList, 'Longitude', lng.toFixed(6));
  }

  if (metadataList && metadataEmpty) {
    metadataList.innerHTML = '';
    const entries = snapshot.metadata && typeof snapshot.metadata === 'object'
      ? Object.entries(snapshot.metadata)
      : [];
    if (entries.length) {
      metadataEmpty.classList.add('hidden');
      entries.forEach(([key, value]) => {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        createDetailRow(metadataList, label.charAt(0).toUpperCase() + label.slice(1), value);
      });
    } else {
      metadataEmpty.classList.remove('hidden');
    }
  }
}

function openPropertyDetail(propertyOrId) {
  const props = Array.isArray(state.data.properties) ? state.data.properties : [];
  const property = typeof propertyOrId === 'object'
    ? propertyOrId
    : props.find(p => String(p.id) === String(propertyOrId));

  if (!property) {
    showToast('Property not found');
    return;
  }

  closePropertyDetail();

  let currentProperty = { ...property };

  const overlay = document.createElement('div');
  overlay.className = 'property-detail-overlay';

  const panel = document.createElement('article');
  panel.className = 'property-detail-panel';
  panel.tabIndex = -1;
  overlay.appendChild(panel);

  const header = document.createElement('header');
  header.className = 'property-detail-header';

  const heading = document.createElement('div');
  heading.className = 'property-detail-heading';

  const labelEl = document.createElement('p');
  labelEl.className = 'property-detail-label';
  const titleEl = document.createElement('h2');
  titleEl.className = 'property-detail-title';
  const sublineEl = document.createElement('p');
  sublineEl.className = 'property-detail-subline';
  const badgeEl = document.createElement('span');
  badgeEl.className = 'property-system-badge';

  heading.append(labelEl, titleEl, sublineEl, badgeEl);
  header.appendChild(heading);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'property-detail-close';
  closeBtn.setAttribute('aria-label', 'Close property details');
  closeBtn.innerHTML = '&times;';
  header.appendChild(closeBtn);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'property-detail-body';
  panel.appendChild(body);

  const heroEl = document.createElement('div');
  heroEl.className = 'property-detail-hero';
  const heroImg = document.createElement('img');
  heroImg.alt = 'Location preview';
  heroEl.appendChild(heroImg);
  body.appendChild(heroEl);

  const systemCopy = document.createElement('p');
  systemCopy.className = 'property-detail-system';
  body.appendChild(systemCopy);

  const actions = document.createElement('div');
  actions.className = 'property-detail-actions';
  const leadBtn = document.createElement('button');
  leadBtn.type = 'button';
  leadBtn.className = 'ghost';
  leadBtn.textContent = 'Add to Leads';
  const appointmentBtn = document.createElement('button');
  appointmentBtn.type = 'button';
  appointmentBtn.className = 'ghost';
  appointmentBtn.textContent = 'Book Appointment';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'primary';
  actions.append(leadBtn, appointmentBtn, toggleBtn);
  body.appendChild(actions);

  const statsSection = document.createElement('section');
  statsSection.className = 'property-detail-section';
  const statsHeading = document.createElement('h3');
  statsHeading.textContent = 'Quick facts';
  const statsList = document.createElement('ul');
  statsList.className = 'property-detail-stats';
  statsSection.append(statsHeading, statsList);
  body.appendChild(statsSection);

  const infoSection = document.createElement('section');
  infoSection.className = 'property-detail-section';
  const infoTitle = document.createElement('h3');
  infoTitle.textContent = 'Listing details';
  const infoList = document.createElement('dl');
  infoList.className = 'property-detail-list';
  infoSection.append(infoTitle, infoList);
  body.appendChild(infoSection);

  const locationSection = document.createElement('section');
  locationSection.className = 'property-detail-section';
  const locationTitle = document.createElement('h3');
  locationTitle.textContent = 'Location';
  const locationList = document.createElement('dl');
  locationList.className = 'property-detail-list';
  locationSection.append(locationTitle, locationList);
  body.appendChild(locationSection);

  const metadataSection = document.createElement('section');
  metadataSection.className = 'property-detail-section';
  const metadataTitle = document.createElement('h3');
  metadataTitle.textContent = 'Additional metadata';
  const metadataList = document.createElement('dl');
  metadataList.className = 'property-detail-list';
  const metadataEmpty = document.createElement('p');
  metadataEmpty.className = 'property-detail-empty';
  metadataEmpty.textContent = 'No additional metadata captured for this property yet.';
  metadataSection.append(metadataTitle, metadataList, metadataEmpty);
  body.appendChild(metadataSection);

  const intelSection = document.createElement('section');
  intelSection.className = 'property-detail-section property-detail-intel';
  const intelTitle = document.createElement('h3');
  intelTitle.textContent = 'Location intelligence';
  const intelStatus = document.createElement('p');
  intelStatus.className = 'intel-status';
  const intelList = document.createElement('ul');
  intelList.className = 'intel-links';
  intelSection.append(intelTitle, intelStatus, intelList);
  body.appendChild(intelSection);

  const nodes = {
    panel,
    labelEl,
    titleEl,
    sublineEl,
    badgeEl,
    heroEl,
    heroImg,
    statsList,
    infoList,
    locationList,
    metadataList,
    metadataEmpty,
    systemCopy,
    toggleBtn,
    intelStatus,
    intelList,
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closePropertyDetail();
  });
  closeBtn.addEventListener('click', () => closePropertyDetail());

  propertyDetailEscapeHandler = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePropertyDetail();
    }
  };
  window.addEventListener('keydown', propertyDetailEscapeHandler);

  leadBtn.addEventListener('click', () => {
    location.hash = `#/leads?prop=${currentProperty.id}`;
    closePropertyDetail();
  });

  appointmentBtn.addEventListener('click', () => {
    closePropertyDetail();
    openAppointmentForm(currentProperty);
  });

  toggleBtn.addEventListener('click', async () => {
    if (!currentProperty?.id) return;
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Updating…';
    const desiredState = !currentProperty.inSystem;
    await markPropertyStatus(currentProperty.id, desiredState);
    const refreshed = (state.data.properties || []).find(p => String(p.id) === String(currentProperty.id));
    if (refreshed) currentProperty = { ...refreshed };
    applyPropertySnapshot(currentProperty, nodes);
  });

  document.body.classList.add('property-detail-open');
  document.body.appendChild(overlay);
  propertyDetailOverlay = overlay;

  applyPropertySnapshot(currentProperty, nodes);

  function renderIntel(info) {
    if (!nodes.intelList?.isConnected) return;
    const { links = [], query = '' } = info || {};
    nodes.intelList.innerHTML = '';
    if (!links.length) {
      nodes.intelStatus.textContent = query
        ? `No published sources found for “${query}” yet.`
        : 'No published sources found for this location yet.';
      return;
    }
    nodes.intelStatus.textContent = query
      ? `AI agent surfaced ${links.length} sources for “${query}”.`
      : `AI agent surfaced ${links.length} sources for this location.`;
    links.forEach(link => {
      if (!link || typeof link !== 'object') return;
      const li = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = link.url || link.href || '#';
      anchor.textContent = link.title || link.url || 'View source';
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      li.appendChild(anchor);
      if (link.snippet) {
        const snippet = document.createElement('p');
        snippet.textContent = link.snippet;
        li.appendChild(snippet);
      }
      nodes.intelList.appendChild(li);
    });
  }

  async function loadIntel() {
    if (!window.API_BASE_URL) {
      nodes.intelStatus.textContent = 'Configure an API base URL to enable AI-powered location research.';
      return;
    }
    nodes.intelStatus.textContent = 'AI agent is scanning the web for nearby insights…';
    nodes.intelStatus.classList.add('loading');
    nodes.intelList.innerHTML = '';
    try {
      const resp = await authFetch(`${window.API_BASE_URL}/properties/${currentProperty.id}/intel`);
      if (!resp.ok) {
        let message = `Request failed (${resp.status})`;
        try {
          const detail = await resp.json();
          if (detail?.detail) message = detail.detail;
        } catch (err) {
          console.warn('Failed to parse property intel error', err);
        }
        throw new Error(message);
      }
      const payload = await resp.json();
      propertyIntelCache.set(currentProperty.id, payload);
      if (payload?.property) {
        mergeProperty(payload.property);
        const refreshed = (state.data.properties || []).find(p => String(p.id) === String(currentProperty.id));
        if (refreshed) {
          currentProperty = { ...refreshed };
          applyPropertySnapshot(currentProperty, nodes);
        }
      }
      if (propertyDetailOverlay === overlay) {
        renderIntel(payload);
      }
    } catch (err) {
      console.error('Failed to load property intel', err);
      nodes.intelStatus.textContent = err?.message || 'Unable to gather location intelligence right now.';
    } finally {
      nodes.intelStatus.classList.remove('loading');
    }
  }

  const cachedIntel = propertyIntelCache.get(currentProperty.id);
  if (cachedIntel) renderIntel(cachedIntel);
  else loadIntel();

  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    closeBtn.focus();
  });
}

window.openPropertyDetail = openPropertyDetail;

async function createPropertyRecord(payload) {
  if (!window.API_BASE_URL) {
    throw new Error('API base URL is not configured');
  }
  const resp = await authFetch(`${window.API_BASE_URL}/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    let message = `Request failed (${resp.status})`;
    try {
      const detail = await resp.json();
      if (detail && typeof detail === 'object' && detail.detail) message = detail.detail;
    } catch (err) {
      console.warn('Failed to parse property create error', err);
    }
    throw new Error(message);
  }
  return resp.json();
}

async function loadInitialProperties() {
  const fallback = async () => {
    try {
      const resp = await fetch('data/listings.csv');
      if (!resp.ok) return [];
      const csv = await resp.text();
      return parseCSV(csv);
    } catch (err) {
      console.warn('Failed to load fallback property data', err);
      return [];
    }
  };

  if (window.API_BASE_URL) {
    try {
      const resp = await authFetch(`${window.API_BASE_URL}/properties`);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) return normaliseProperties(data);
      } else {
        console.warn('Property API returned non-OK response', resp.status);
      }
    } catch (err) {
      console.warn('Failed to load properties from API', err);
    }
  }

  const fallbackData = await fallback();
  return normaliseProperties(fallbackData);
}

function updateGmailAccount(patch={}){
  if(!patch||typeof patch!=='object') return gmailAccount;
  const next={ ...gmailAccount };
  if(Object.prototype.hasOwnProperty.call(patch,'email')) next.email=patch.email;
  if(Object.prototype.hasOwnProperty.call(patch,'expiresAt')) next.expiresAt=patch.expiresAt;
  if(Object.prototype.hasOwnProperty.call(patch,'scope')) next.scope=patch.scope;
  if(Object.prototype.hasOwnProperty.call(patch,'tokenType')) next.tokenType=patch.tokenType;
  gmailAccount=next;
  window.GMAIL_ACCOUNT=gmailAccount;
  if(gmailAccount.email){ window.GMAIL_ACCOUNT_EMAIL=gmailAccount.email; }
  else { delete window.GMAIL_ACCOUNT_EMAIL; }
  return gmailAccount;
}

function setGmailAccessToken(token,meta={}){
  if(!token) return;
  window.GMAIL_ACCESS_TOKEN=token;
  window.GMAIL_TOKEN_INFO={ ...meta, access_token:token };
  const patch={};
  if(Object.prototype.hasOwnProperty.call(meta,'expires_at')) patch.expiresAt=meta.expires_at;
  if(Object.prototype.hasOwnProperty.call(meta,'scope')) patch.scope=meta.scope;
  if(Object.prototype.hasOwnProperty.call(meta,'token_type')) patch.tokenType=meta.token_type;
  if(Object.prototype.hasOwnProperty.call(meta,'email')) patch.email=meta.email;
  if(Object.keys(patch).length) updateGmailAccount(patch);
  if(!gmailTokenListeners.length) return;
  const listeners=gmailTokenListeners.splice(0);
  listeners.forEach(entry=>{
    if(entry.type==='listener' && typeof entry.handler==='function'){
      try{ entry.handler(); }catch(err){ console.error('Gmail token listener failed',err); }
    } else if(entry.type==='promise' && typeof entry.resolve==='function'){
      entry.resolve(token);
    }
  });
}

function handleGmailTokenError(error){
  if(!gmailTokenListeners.length) return;
  const remaining=[];
  gmailTokenListeners.splice(0).forEach(entry=>{
    if(entry.type==='promise' && typeof entry.reject==='function'){
      entry.reject(error);
    } else if(entry.type==='listener'){
      remaining.push(entry);
    }
  });
  if(remaining.length) gmailTokenListeners.push(...remaining);
}

function requestGmailToken(prompt='consent'){
  if(!gmailTokenClient){
    return Promise.reject(new Error('Gmail auth not initialized'));
  }
  return new Promise((resolve,reject)=>{
    gmailTokenListeners.push({ type:'promise', resolve, reject });
    try{
      gmailTokenClient.requestAccessToken({ prompt });
    }catch(err){
      const index=gmailTokenListeners.findIndex(entry=>entry.resolve===resolve && entry.reject===reject);
      if(index>-1) gmailTokenListeners.splice(index,1);
      reject(err);
    }
  });
}

async function saveGmailAccountDetails(details={}){
  if(!details||typeof details!=='object') return;
  const payload={};
  if(Object.prototype.hasOwnProperty.call(details,'email')) payload.email=details.email;
  if(Object.prototype.hasOwnProperty.call(details,'access_token')) payload.access_token=details.access_token;
  if(Object.prototype.hasOwnProperty.call(details,'token_type')) payload.token_type=details.token_type;
  if(Object.prototype.hasOwnProperty.call(details,'scope')) payload.scope=details.scope;
  if(Object.prototype.hasOwnProperty.call(details,'expires_at')) payload.expires_at=details.expires_at;
  if(Object.prototype.hasOwnProperty.call(details,'expires_in')) payload.expires_in=details.expires_in;
  if(!Object.keys(payload).length) return;
  const patch={};
  if(Object.prototype.hasOwnProperty.call(payload,'email')) patch.email=payload.email;
  if(Object.prototype.hasOwnProperty.call(payload,'expires_at')) patch.expiresAt=payload.expires_at;
  if(Object.prototype.hasOwnProperty.call(payload,'scope')) patch.scope=payload.scope;
  if(Object.prototype.hasOwnProperty.call(payload,'token_type')) patch.tokenType=payload.token_type;
  if(Object.keys(patch).length) updateGmailAccount(patch);
  if(!window.API_BASE_URL) return;
  try{
    await authFetch(`${window.API_BASE_URL}/emails/gmail/token`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(payload)
    });
  }catch(err){
    console.warn('Failed to persist Gmail account',err);
  }
}

async function ensureStoredGmailAccessToken({ silent=false }={}){
  if(!window.API_BASE_URL) return null;
  try{
    const resp=await authFetch(`${window.API_BASE_URL}/emails/gmail/token`);
    if(!resp.ok) return null;
    const data=await resp.json();
    if(data && typeof data==='object'){
      const patch={};
      if(Object.prototype.hasOwnProperty.call(data,'email')) patch.email=data.email;
      if(Object.prototype.hasOwnProperty.call(data,'expires_at')) patch.expiresAt=data.expires_at;
      if(Object.prototype.hasOwnProperty.call(data,'scope')) patch.scope=data.scope;
      if(Object.prototype.hasOwnProperty.call(data,'token_type')) patch.tokenType=data.token_type;
      if(Object.keys(patch).length) updateGmailAccount(patch);
      if(data.access_token){
        const expiresAt=data.expires_at ? Date.parse(data.expires_at) : null;
        if(!expiresAt || expiresAt> Date.now()+60000){
          setGmailAccessToken(data.access_token,{
            expires_at:data.expires_at,
            scope:data.scope,
            token_type:data.token_type,
            email:data.email
          });
        }
      }
    }
  }catch(err){
    if(!silent) console.warn('Failed to load stored Gmail token',err);
    return null;
  }
  return {
    email:gmailAccount.email,
    expires_at:gmailAccount.expiresAt,
    scope:gmailAccount.scope,
    token_type:gmailAccount.tokenType,
    accessToken:window.GMAIL_ACCESS_TOKEN || null
  };
}

async function loadStoredGmailToken(){
  const initial=await ensureStoredGmailAccessToken({ silent:true });
  if(window.GMAIL_ACCESS_TOKEN){
    return {
      email:gmailAccount.email,
      expires_at:gmailAccount.expiresAt,
      scope:gmailAccount.scope,
      token_type:gmailAccount.tokenType,
      accessToken:window.GMAIL_ACCESS_TOKEN
    };
  }
  if(!gmailTokenClient){
    return initial || {
      email:gmailAccount.email,
      expires_at:gmailAccount.expiresAt,
      scope:gmailAccount.scope,
      token_type:gmailAccount.tokenType,
      accessToken:null
    };
  }
  try{
    await requestGmailAccessToken({ prompt:'none' });
  }catch(err){
    console.warn('Silent Gmail authorization failed',err);
  }
  return {
    email:gmailAccount.email,
    expires_at:gmailAccount.expiresAt,
    scope:gmailAccount.scope,
    token_type:gmailAccount.tokenType,
    accessToken:window.GMAIL_ACCESS_TOKEN || null
  };
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

function initGmailAuth() {
  if (!window.google || !window.google.accounts || !window.GOOGLE_CLIENT_ID) {
    setTimeout(initGmailAuth, 500);
    return;
  }
  gmailTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: window.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose',
    callback: resp => {
      if (resp.access_token) {
        const expiresAt = resp.expires_in
          ? new Date(Date.now() + resp.expires_in * 1000).toISOString()
          : null;
        setGmailAccessToken(resp.access_token, {
          expires_at: expiresAt,
          scope: resp.scope,
          token_type: resp.token_type
        });
        saveGmailAccountDetails({
          access_token: resp.access_token,
          scope: resp.scope,
          token_type: resp.token_type,
          expires_at: expiresAt,
          expires_in: resp.expires_in
        });
      } else if (resp.error) {
        console.warn('Gmail token request failed', resp.error);
        handleGmailTokenError(resp.error);
      }
    }
  });
}

function requestGmailAccessToken(options = {}) {
  return requestGmailToken(options.prompt ?? 'consent');
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
    loadInitialProperties(),
    mapReady
  ]).then(([d,properties])=>{
    d.properties=normaliseProperties(properties);
    // Leverages backend API for lead data so remove any bundled sample leads
    d.leads = [];
    state.data=d;
    init();
  }).catch(err=>{
    console.error('Failed to initialise application',err);
  });
  initGoogleAuth();
  initGmailAuth();
}

startApp();

function init(){
  topbarAPI=initTopbar();
  // initAssistantDrawer();
  initCommandPalette(state.data);
  initToast();
  if(!location.hash) location.hash = '#/agent';
  window.addEventListener('hashchange',router);
  router();
  setupShortcuts();
  setupBackground();
}

async function router(){
  const hash=location.hash||'#/agent';
  const [route,query]=hash.split('?');
  const main=document.getElementById('main');
  main.innerHTML='';
  if(route.startsWith('#/agent')){
    topbarAPI.setActive('#/agent');
    if(!agentView){
      agentView=createAgentChat();
    }
    main.appendChild(agentView);
  } else if(route.startsWith('#/sourcing')){
    topbarAPI.setActive('#/sourcing');
    const wrap=document.createElement('div');
    wrap.className='sourcing-view';
    const map=document.createElement('div');map.id='map';
    const addBtn=document.createElement('button');
    addBtn.textContent='Add Property';
    const propertySections=[
        {
          title:'Listing Snapshot',
          description:'Key availability and pricing inputs for the record.',
          fields:[
            { label:'Listing Number', name:'listingNumber', required:true },
            { label:'Listing Status', name:'listingStatus' },
            { label:'Sale or Rent', name:'saleOrRent' },
            { label:'Property Type', name:'propertyType' },
            { label:'Property Subtype', name:'propertySubtype' },
            { label:'List Price', name:'listPrice', type:'number', step:'any', required:true },
            { label:'List Date', name:'listDate', type:'date' },
            { label:'Pending Date', name:'pendingDate', type:'date' },
            { label:'Sold Date', name:'soldDate', type:'date' },
            { label:'Sold Price', name:'soldPrice', type:'number', step:'any' },
            { label:'Withdrawn Date', name:'withdrawnDate', type:'date' },
            { label:'Expired Date', name:'expiredDate', type:'date' },
            { label:'REO', name:'reo', type:'checkbox' },
            { label:'Short Sale', name:'shortSale', type:'checkbox' }
          ]
        },
        {
          title:'Location & Lot',
          description:'Geographic identifiers for mapping, tax searches, and lot metrics.',
          fields:[
            { label:'Address', name:'address', required:true, full:true },
            { label:'City', name:'city' },
            { label:'State', name:'state' },
            { label:'Zip Code', name:'zipCode' },
            { label:'County', name:'county' },
            { label:'Parcel ID #', name:'parcelId' },
            { label:'MLS Area', name:'mlsArea' },
            { label:'Subdivision', name:'subdivision' },
            { label:'Development Name', name:'developmentName' },
            { label:'Zoning', name:'zoning' },
            { label:'Lot Size (sf)', name:'lotSizeSf', type:'number', step:'any' },
            { label:'Lot Size (acres)', name:'lotSizeAcres', type:'number', step:'any' },
            { label:'Longitude', name:'longitude', type:'number', step:'any', required:true },
            { label:'Latitude', name:'latitude', type:'number', step:'any', required:true }
          ]
        },
        {
          title:'Property Specs',
          description:'Structural details and amenities buyers ask about most.',
          fields:[
            { label:'Building/Living Area (sf)', name:'buildingArea', type:'number', step:'any' },
            { label:'Property SqFt', name:'propertySqFt', type:'number', step:'any' },
            { label:'PPSF', name:'ppsf', type:'number', step:'any' },
            { label:'Bedrooms', name:'bedrooms', type:'number', step:'1' },
            { label:'Full Bathrooms', name:'fullBathrooms', type:'number', step:'1' },
            { label:'Half Bathrooms', name:'halfBathrooms', type:'number', step:'1' },
            { label:'Year Built', name:'yearBuilt', type:'number', step:'1' },
            { label:'Style', name:'style' },
            { label:'Parking Total', name:'parkingTotal', type:'number', step:'1' },
            { label:'Pool', name:'pool', type:'checkbox' },
            { label:'Garage', name:'garage', type:'checkbox' },
            { label:'Waterfront', name:'waterfront', type:'checkbox' }
          ]
        },
        {
          title:'Representation',
          description:'Capture the brokerage professionals tied to this listing.',
          fields:[
            { label:'Listing Agent Name', name:'listingAgentName', full:true },
            { label:'Listing Office Name', name:'listingOfficeName', full:true },
            { label:'Listing Agent Phone Number', name:'listingAgentPhone', type:'tel' },
            { label:'Listing Agent E-Mail Address', name:'listingAgentEmail', type:'email', full:true },
            { label:'Sale Agent Name', name:'saleAgentName', full:true },
            { label:'Sale Office Name', name:'saleOfficeName', full:true }
          ],
          columns:1
        },
        {
          title:'Ownership & Financials',
          description:'Owner of record and cashflow metrics for underwriting.',
          fields:[
            { label:'Owner Name 1', name:'ownerName1', full:true },
            { label:'Owner Name 2', name:'ownerName2', full:true },
            { label:'Owner Address', name:'ownerAddress', full:true },
            { label:'Owner City', name:'ownerCity' },
            { label:'Owner State', name:'ownerState' },
            { label:'Owner Zip Code', name:'ownerZipCode' },
            { label:'Owner County', name:'ownerCounty' },
            { label:'Owner Occupied', name:'ownerOccupied', type:'checkbox' },
            { label:'Net Operating Income', name:'netOperatingIncome', type:'number', step:'any' },
            { label:'Gross Operating Income', name:'grossOperatingIncome', type:'number', step:'any' },
            { label:'Last Sale Date (Tax Records)', name:'lastSaleDate', type:'date' }
          ]
        },
        {
          title:'Schools & Community',
          description:'Keep marketing copy consistent with nearby education options.',
          columns:1,
          fields:[
            { label:'Elementary School', name:'elementarySchool' },
            { label:'Middle School', name:'middleSchool' },
            { label:'High School', name:'highSchool' }
          ]
        }
      ];
    const propertyFields=propertySections.flatMap(section=>section.fields);
    const numberFieldNames=propertyFields.filter(field=>field.type==='number').map(field=>field.name);
    const checkboxFieldNames=propertyFields.filter(field=>field.type==='checkbox').map(field=>field.name);
    function openAddPropertyModal(){
      const overlay=document.createElement('div');
      overlay.className='modal';
      const form=document.createElement('form');
      form.className='property-form glass-form';
      const propertyMarkup=propertySections.map(section=>{
        const gridClasses=['property-section-grid'];
        if(section.columns===1) gridClasses.push('single-column');
        const fieldsMarkup=section.fields.map(field=>{
          const inputId=`property-${field.name}`;
          const attrList=[`name="${field.name}"`,`id="${inputId}"`];
          if(field.step) attrList.push(`step="${field.step}"`);
          if(field.required) attrList.push('required');
          const fieldClass=[
            'property-field',
            field.full?'full':'',
            field.type==='checkbox'?'checkbox':''
          ].filter(Boolean).join(' ');
          if(field.type==='checkbox'){
            const checkboxAttrs=[...attrList, `type="checkbox"`];
            return `<label class="${fieldClass}"><input ${checkboxAttrs.join(' ')} /><span>${field.label}</span></label>`;
          }
          const inputType=field.type||'text';
          const inputAttrs=[...attrList, `type="${inputType}"`];
          return `<div class="${fieldClass}"><label for="${inputId}">${field.label}</label><input ${inputAttrs.join(' ')} /></div>`;
        }).join('');
        return `<section class="property-section">
          <div class="section-heading">
            <h3>${section.title}</h3>
            ${section.description?`<p>${section.description}</p>`:''}
          </div>
          <div class="${gridClasses.join(' ')}">${fieldsMarkup}</div>
        </section>`;
      }).join('');
      form.innerHTML=`<div class="property-form-header">
          <h2>Add Property</h2>
          <p>Complete the listing dossier so your team can collaborate without leaving the map.</p>
        </div>
        <div class="property-content">${propertyMarkup}</div>
        <div class='form-actions'>
          <button type='button' id='cancelProperty' class='ghost'>Cancel</button>
          <button type='submit' class='primary'>Save</button>
        </div>`;
      const close=()=>overlay.remove();
      overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        if(!form.reportValidity()) return;
        const fd=new FormData(form);
        const obj=Object.fromEntries(fd.entries());
        checkboxFieldNames.forEach(name=>{
          const input=form.elements[name];
          obj[name]=input?input.checked:false;
        });
        numberFieldNames.forEach(name=>{
          const value=obj[name];
          if(value!==undefined && value!=='') obj[name]=parseFloat(value);
        });
        const baths=(obj.fullBathrooms||0)+0.5*(obj.halfBathrooms||0);
        const priceValue=obj.listPrice;
        const price=typeof priceValue==='number' && !Number.isNaN(priceValue)
          ? new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD' }).format(priceValue)
          : (priceValue?String(priceValue).trim():undefined);
        const addressParts=[obj.address,obj.city,obj.state].filter(Boolean);
        let addressDisplay=obj.address||'';
        if(addressParts.length){
          addressDisplay=addressParts.join(', ');
          if(obj.zipCode) addressDisplay=`${addressDisplay} ${obj.zipCode}`.trim();
        }
        const payload={
          listingNumber:obj.listingNumber||undefined,
          address:addressDisplay||obj.address,
          city:obj.city||undefined,
          state:obj.state||undefined,
          zipCode:obj.zipCode||undefined,
          price:price||undefined,
          beds:obj.bedrooms??undefined,
          baths:baths||undefined,
          year:obj.yearBuilt??undefined,
          status:obj.listingStatus||undefined,
          saleOrRent:obj.saleOrRent||undefined,
          type:obj.propertyType||obj.propertySubtype||undefined,
          lat:obj.latitude??undefined,
          lng:obj.longitude??undefined
        };
        const metadata={...obj};
        [
          'listingNumber','address','city','state','zipCode','listPrice','bedrooms','fullBathrooms','halfBathrooms','yearBuilt','listingStatus','saleOrRent','propertyType','propertySubtype','latitude','longitude'
        ].forEach(key=>{ delete metadata[key]; });
        if(Object.keys(metadata).length) payload.metadata=metadata;
        try{
          const saved=await createPropertyRecord(payload);
          mergeProperty(saved);
          showToast('Property saved to database');
          close();
          refreshSourcingView(saved.id);
        }catch(err){
          console.error('Failed to save property',err);
          showToast(err?.message || 'Failed to save property');
        }
      });
      form.querySelector('#cancelProperty').addEventListener('click',()=>{close();});
      overlay.appendChild(form);
      document.body.appendChild(overlay);
    }
    addBtn.addEventListener('click',openAddPropertyModal);
    state.data.properties=normaliseProperties(state.data.properties||[]);
    const props=state.data.properties||[];
    const params=new URLSearchParams(query||'');
    const initialProp=params.get('prop');
    const addIntent=params.get('add');
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
          const resetIcon=prev?.__isRemoved ? (state.removedIcon||state.defaultIcon) : state.defaultIcon;
          if(resetIcon) prev.setIcon(resetIcon);
          if(prev.infoWindow) prev.infoWindow.close();
        }
        const marker=state.markers[p.id];
        if(marker){
          const activeIcon=marker.__isRemoved ? (state.removedActiveIcon||state.activeIcon||state.removedIcon) : state.activeIcon;
          if(activeIcon) marker.setIcon(activeIcon);
          if(marker.infoWindow) marker.infoWindow.open(state.gmap,marker);
          state.activeMarkerId=p.id;
        }
      } else {
        state.gmap.setView([lat,lng],16);
        if(state.activeMarkerId && state.markers[state.activeMarkerId]){
          const prev=state.markers[state.activeMarkerId];
          if(prev.setIcon){
            const resetIcon=prev?.__isRemoved ? (state.removedIcon||state.defaultIcon) : state.defaultIcon;
            if(resetIcon) prev.setIcon(resetIcon);
          }
        }
        const marker=state.markers[p.id];
        if(marker){
          marker.openPopup();
          if(marker.setIcon){
            const activeIcon=marker.__isRemoved ? (state.removedActiveIcon||state.removedIcon||state.activeIcon) : state.activeIcon;
            if(activeIcon) marker.setIcon(activeIcon);
          }
          const popup=marker.getPopup();
          if(popup){
            const el=popup.getElement();
            if(el){
              const btn=el.querySelector('.add-lead');
              if(btn) btn.onclick=()=>{location.hash=`#/leads?prop=${p.id}`;};
            const view=el.querySelector('.view-details');
            if(view) view.onclick=()=>{openPropertyDetail(p);};
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
    const grid=createDataGrid(props,{
      onSelect:selectProperty,
      onRemove:id=>markPropertyStatus(id,false),
      onRestore:id=>markPropertyStatus(id,true),
      onView:id=>openPropertyDetail(id)
    });
    wrap.append(map,addBtn,grid.el);
    grid.update(props);
    main.appendChild(wrap);
    if(addIntent==='property'){
      openAddPropertyModal();
      if(history.replaceState){
        history.replaceState(null,'','#/sourcing');
      } else {
        location.hash='#/sourcing';
      }
    }
    state.markers={};
    const center=props.length?{lat:Number(props[0].lat),lng:Number(props[0].lng)}:{lat:39.5,lng:-98.35};
    const zoom=props.length?10:5;
    if(window.google && window.google.maps){
      state.gmap=new google.maps.Map(map,{center,zoom,streetViewControl:true});
      state.defaultIcon=state.defaultIcon||'https://maps.google.com/mapfiles/ms/icons/blue-dot.png';
      state.activeIcon=state.activeIcon||'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
      state.removedIcon=state.removedIcon||'https://maps.google.com/mapfiles/ms/icons/grey-dot.png';
      state.removedActiveIcon=state.removedActiveIcon||'https://maps.google.com/mapfiles/ms/icons/orange-dot.png';
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
          const statusBadge=!p.inSystem?"<div class='map-status removed'>Not in system</div>":'';
          const content=document.createElement('div');
          content.innerHTML=`${imgSrc?`<img src="${imgSrc}" alt="Property image" style="max-width:200px"/><br/>`:''}${fullAddress}<br/>${p.price||''}${details?`<br/>${details}`:''}${statusBadge?`<br/>${statusBadge}`:''}<br/><button class='add-lead'>Add to Leads</button> <button class='view-details'>View Details</button>`;
          const baseIcon=p.inSystem?state.defaultIcon:state.removedIcon;
          const marker=new google.maps.Marker({position,map:state.gmap,icon:baseIcon});
          marker.__isRemoved=!p.inSystem;
          marker.infoWindow=new google.maps.InfoWindow({content});
          content.querySelector('.add-lead')?.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
          content.querySelector('.view-details')?.addEventListener('click',()=>{openPropertyDetail(p);});
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
      state.removedIcon=state.removedIcon||L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
      state.removedActiveIcon=state.removedActiveIcon||L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'});
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
          const statusBadge=!p.inSystem?"<div class='map-status removed'>Not in system</div>":'';
          const baseIcon=p.inSystem?state.defaultIcon:state.removedIcon;
          const marker=L.marker(position,{icon:baseIcon}).addTo(state.gmap).bindPopup(`<div>${imgSrc?`<img src="${imgSrc}" alt="Property image" style="max-width:200px"/><br/>`:''}${fullAddress}<br/>${p.price||''}${details?`<br/>${details}`:''}${statusBadge?`<br/>${statusBadge}`:''}<br/><button class='add-lead'>Add to Leads</button> <button class='view-details'>View Details</button></div>`);
          marker.__isRemoved=!p.inSystem;
          state.markers[p.id]=marker;
          bounds.extend(position);
          marker.on('click',()=>selectProperty(p.id));
          marker.on('popupopen',e=>{
            const el=e.popup.getElement();
            if(!el) return;
            const btn=el.querySelector('.add-lead');
            if(btn) btn.addEventListener('click',()=>{location.hash=`#/leads?prop=${p.id}`;});
            const view=el.querySelector('.view-details');
            if(view) view.addEventListener('click',()=>{openPropertyDetail(p);});
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
      if(propId) openPropertyDetail(propId);
      if(history.replaceState){
        history.replaceState(null,'','#/sourcing');
      } else {
        location.hash='#/sourcing';
      }
      return;
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
        form.className='lead-form glass-form';
        const isEdit=!!lead;
        const fullAddress=property? (property.city?`${property.address}, ${property.city}`:property.address):'';
        const escapeHtml=value=>String(value??'')
          .replace(/&/g,'&amp;')
          .replace(/</g,'&lt;')
          .replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;')
          .replace(/'/g,'&#39;');
        const contextLabel=property?fullAddress:(lead&&lead.property?lead.property:'');
        const fields=[
          { label:'Listing Number', name:'listing', required:true, value:lead?.listingNumber ?? property?.listingNumber ?? '' },
          { label:'Name', name:'name', required:true, value:lead?.name ?? '' },
          { label:'Email', name:'email', type:'email', value:lead?.email ?? '' },
          { label:'Phone', name:'phone', type:'tel', value:lead?.phone ?? '' },
          { label:'Address', name:'address', value:lead?.address ?? '' },
          { label:'Notes', name:'notes', type:'textarea', value:lead?.notes ?? '', full:true }
        ];
        const fieldsMarkup=fields.map(field=>{
          const id=`lead-${field.name}`;
          const attrs=[`name="${field.name}"`,`id="${id}"`];
          if(field.type && field.type!=='textarea') attrs.push(`type="${field.type}"`);
          if(field.required) attrs.push('required');
          const classes=['modal-field'];
          if(field.full) classes.push('full');
          const label=`<label for="${id}">${field.label}</label>`;
          if(field.type==='textarea'){
            return `<div class="${classes.join(' ')}">${label}<textarea ${attrs.join(' ')}>${escapeHtml(field.value)}</textarea></div>`;
          }
          const valueAttr=`value="${escapeHtml(field.value)}"`;
          return `<div class="${classes.join(' ')}">${label}<input ${attrs.join(' ')} ${valueAttr} /></div>`;
        }).join('');
        const contextChip=contextLabel?`<span class="modal-chip">${escapeHtml(contextLabel)}</span>`:'';
        form.innerHTML=`<div class="modal-header">
            <h2>${isEdit?`Edit Lead`:`Add Lead`}</h2>
            ${contextChip}
            <p>Keep pipeline details clear so your team can follow up without leaving the workspace.</p>
          </div>
          <div class="form-fields">${fieldsMarkup}</div>
          <div class='form-actions'>
            <button type='button' id='cancelLead' class='ghost'>Cancel</button>
            <button type='submit' class='primary'>${isEdit?'Update Lead':'Save Lead'}</button>
          </div>`;
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
  } else if(route.startsWith('#/emails')){
    topbarAPI.setActive('#/emails');
    if(!emailsEl){
      emailsEl=createEmailsView({
        getToken: () => window.GMAIL_ACCESS_TOKEN,
        requestToken: requestGmailAccessToken,
        onToken: onGmailToken,
        authFetch,
        apiBaseUrl: window.API_BASE_URL || '',
        loadStoredToken: loadStoredGmailToken,
        saveAccount: saveGmailAccountDetails
      });
    }
    main.appendChild(emailsEl);
  }
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
    const priceRaw=obj[' List Price ']||obj['List Price']||'';
    const price=typeof priceRaw==='string'?priceRaw.trim():priceRaw;
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
    return {id,address,price,lat,lng,beds,baths,year,status,saleOrRent,type,inSystem:true};
  });
}
