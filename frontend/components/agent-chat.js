export function createAgentChat() {
  const wrap = document.createElement('div');
  wrap.className = 'agent-chat';
  wrap.innerHTML = `
    <div id="agent-map"></div>
    <div class="chat-box">
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
  let leafletIcon;
  let history = JSON.parse(sessionStorage.getItem('agentChatMessages') || '[]');

  function initMap() {
    if (window.google?.maps) {
      map = new google.maps.Map(mapEl, { center: { lat: 39.5, lng: -98.35 }, zoom: 5 });
    } else if (window.L) {
      map = L.map(mapEl).setView([39.5, -98.35], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      leafletIcon = L.icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x-red.png', iconSize: [25,41], iconAnchor: [12,41], popupAnchor: [1,-34], shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' });
    } else {
      mapEl.textContent = 'Loading map…';
      setTimeout(initMap, 300);
    }
  }
  initMap();

  function updateMap(props) {
    if (!map) return;
    if (window.google?.maps) {
      markers.forEach(m => m.setMap(null));
    } else if (window.L) {
      markers.forEach(m => m.remove());
    }
    markers = [];
    markerMap = {};
    if (!props.length) return;
    let bounds;
    if (window.google?.maps) bounds = new google.maps.LatLngBounds();
    else if (window.L) bounds = L.latLngBounds();
    props.forEach(p => {
      const lat = Number(p.lat), lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      if (window.google?.maps) {
        const marker = new google.maps.Marker({ position: { lat, lng }, map, icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' });
        let content = '';
        if (p.image) {
          content += `<img src="${p.image}" alt="Property image" style="max-width:200px"/>`;
        }
        content += `<div><a href="#/property?prop=${p.id}">View details</a></div>`;
        const info = new google.maps.InfoWindow({ content });
        marker.addListener('click', () => info.open(map, marker));
        markers.push(marker);
        markerMap[p.id] = marker;
        bounds.extend({ lat, lng });
      } else if (window.L) {
        let content = '';
        if (p.image) {
          content += `<img src="${p.image}" alt="Property image" style="max-width:200px"/>`;
        }
        content += `<div><a href="#/property?prop=${p.id}">View details</a></div>`;
        const marker = L.marker([lat, lng], { icon: leafletIcon }).addTo(map);
        marker.bindPopup(content);
        markers.push(marker);
        markerMap[p.id] = marker;
        bounds.extend([lat, lng]);
      }
    });
    if (bounds) {
      if (window.google?.maps) {
        if (props.length > 1) map.fitBounds(bounds); else { map.setCenter(bounds.getCenter()); map.setZoom(14); }
      } else if (window.L) {
        if (props.length > 1) map.fitBounds(bounds); else map.setView(bounds.getCenter(), 14);
      }
    }
  }
  function focusProperty(p) {
    if (!map) return;
    const lat = Number(p.lat), lng = Number(p.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    if (window.google?.maps) {
      map.setCenter({ lat, lng });
      map.setZoom(14);
      const m = markerMap[p.id];
      if (m) google.maps.event.trigger(m, 'click');
    } else if (window.L) {
      map.setView([lat, lng], 14);
      const m = markerMap[p.id];
      if (m && m.openPopup) m.openPopup();
    }
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
        headers: { 'Content-Type': 'application/json' },
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
      const propList = Array.isArray(sql_reply) && sql_reply.length ? sql_reply : (properties || []);
      addMessage('bot', textReply, propList);
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
        card.className = 'prop-card';
        card.innerHTML = `
          <img src="${p.image}" alt="Property image" />
          <div class="details">
            <div>${p.address || ''}</div>
            <div>${p.price || ''}</div>
          </div>
          <button class="view-icon" title="View property">🔍</button>
        `;
        const imgEl = card.querySelector('img');
        if (imgEl) imgEl.addEventListener('click', () => focusProperty(p));
        const btn = card.querySelector('.view-icon');
        btn.addEventListener('click', () => {
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

  history.forEach(m => addMessage(m.role, m.text, m.props, false));

  clearBtn.addEventListener('click', () => {
    messages.innerHTML = '';
    history = [];
    sessionStorage.removeItem('agentChatMessages');
    updateMap([]);
  });

  return wrap;
}
