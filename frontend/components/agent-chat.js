export function createAgentChat() {
  const wrap = document.createElement('div');
  wrap.className = 'agent-chat';
  wrap.innerHTML = `
    <div id="agent-map" class="glass"></div>
    <div class="chat-box glass">
      <div id="chat-messages" class="chat-messages"></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" placeholder="Type your message..." autocomplete="off" />
        <button type="submit">Send</button>
        <button id="clear-chat" type="button">Clear</button>
      </form>
    </div>
  `;

  const form = wrap.querySelector('#chat-form');
  const input = wrap.querySelector('#chat-input');
  const messages = wrap.querySelector('#chat-messages');
  const clearBtn = wrap.querySelector('#clear-chat');
  const mapEl = wrap.querySelector('#agent-map');
  let map;
  let markers = [];
  let markerMap = {};
  let defaultIcon;
  let activeIcon;
  let activeMarkerId;
  let pendingProps = [];
  let history = JSON.parse(sessionStorage.getItem('agentChatMessages') || '[]');

  async function authHeader() {
    try {
      const token = (await window.aws_amplify.Auth.currentSession()).getIdToken().getJwtToken();
      return { Authorization: token };
    } catch {
      return {};
    }
  }

  function normalizeProp(p) {
    const id = p.id || p.ID || p['Listing Number'] || p.listingNumber || Math.random().toString(36).slice(2);
    const address = p.address || p.Address || '';
    const price = p.price || p.Price || p['List Price'] || p[' List Price '] || '';
    const lat = parseFloat(p.lat ?? p.latitude ?? p.Latitude);
    const lng = parseFloat(p.lng ?? p.longitude ?? p.Longitude);
    const image = p.image || p.Image || '';
    return { id, address, price, lat, lng, image };
  }

  function initMap() {
    if (window.L) {
      map = L.map(mapEl).setView([39.5, -98.35], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      defaultIcon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
      });
      activeIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
      });
    } else {
      mapEl.textContent = 'Loading map…';
      setTimeout(initMap, 300);
      return;
    }
    if (pendingProps.length) updateMap(pendingProps);
  }
  // Initialize the map after the element is in the DOM to ensure proper sizing
  setTimeout(initMap, 0);

  function updateMap(props) {
    pendingProps = props;
    if (!map) return;
    markers.forEach(m => m.remove());
    markers = [];
    markerMap = {};
    if (!props.length) return;
    activeMarkerId = null;
    const bounds = L.latLngBounds();
    props.forEach(p => {
      const lat = Number(p.lat), lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      let content = '';
      if (p.image) {
        content += `<img src="${p.image}" alt="Property image" style="max-width:200px"/>`;
      }
      content += `<div><a href="#/property?prop=${p.id}">View details</a></div>`;
      const marker = L.marker([lat, lng], { icon: defaultIcon }).addTo(map);
      marker.bindPopup(content);
      markers.push(marker);
      markerMap[p.id] = marker;
      bounds.extend([lat, lng]);
    });
    if (props.length > 1) map.fitBounds(bounds); else map.setView(bounds.getCenter(), 14);
  }
  function focusProperty(p) {
    if (!map) return;
    const lat = Number(p.lat), lng = Number(p.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    map.setView([lat, lng], 14);
    const m = markerMap[p.id];
    if (m) {
      markers.forEach(marker => marker.setIcon(defaultIcon));
      m.setIcon(activeIcon);
      if (m.openPopup) m.openPopup();
      activeMarkerId = p.id;
    }
    document.querySelectorAll('.prop-card').forEach(card => {
      if (card.dataset.id === String(p.id)) card.classList.add('active');
      else card.classList.remove('active');
    });
  }
  const API_BASE = window.API_BASE_URL || 'http://localhost:8000';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        // Send both "text" and "message" keys for compatibility
        body: JSON.stringify({ text, message: text })
      });
      const data = await resp.json();
      const { reply, answer, sql_reply, properties } = data;
      let textReply = reply || answer;
      if (!textReply && Array.isArray(sql_reply) && sql_reply.length > 0) {
        textReply = JSON.stringify(sql_reply, null, 2);
      }
      if (!textReply) textReply = 'No reply';
      const rawProps = Array.isArray(sql_reply) && sql_reply.length ? sql_reply : (properties || []);
      const normProps = rawProps.map(normalizeProp);
      addMessage('bot', textReply, normProps);
    } catch (err) {
      addMessage('bot', 'Error contacting server');
    }
  });

  function addMessage(role, text, props = [], save = true) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre-wrap';
    div.appendChild(span);

    if (props.length) {
      updateMap(props);
      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'prop-cards';
      props.forEach(p => {
        const card = document.createElement('div');
        card.className = 'prop-card glass';
        card.dataset.id = p.id;
        card.innerHTML = `
          <img src="${p.image}" alt="Property image" />
          <div class="details">
            <div>${p.address || ''}</div>
            <div>${p.price || ''}</div>
          </div>
          <button class="view-icon" title="View property">🔍</button>
        `;
        card.addEventListener('click', () => focusProperty(p));
        const btn = card.querySelector('.view-icon');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          location.hash = `#/property?prop=${p.id}`;
        });
        cardsWrap.appendChild(card);
      });
      div.appendChild(cardsWrap);
    } else {
      updateMap([]);
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;

    if (save) {
      history.push({ role, text, props });
      sessionStorage.setItem('agentChatMessages', JSON.stringify(history));
    }
  }

  history.forEach(m => addMessage(m.role, m.text, (m.props || []).map(normalizeProp), false));

  clearBtn.addEventListener('click', () => {
    messages.innerHTML = '';
    history = [];
    sessionStorage.removeItem('agentChatMessages');
    updateMap([]);
  });

  return wrap;
}
