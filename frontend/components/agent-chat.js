export function createAgentChat() {
  const wrap = document.createElement('div');
  wrap.className = 'agent-chat';
  wrap.innerHTML = `
    <div class="chat-box">
      <div id="chat-messages" class="chat-messages"></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" placeholder="Type your message..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `;

  const form = wrap.querySelector('#chat-form');
  const input = wrap.querySelector('#chat-input');
  const messages = wrap.querySelector('#chat-messages');
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
      addMessage('bot', textReply, properties || []);
    } catch (err) {
      addMessage('bot', 'Error contacting server');
    }
  });

  function addMessage(role, text, props = []) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre-wrap';
    div.appendChild(span);

    if (props.length) {
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
        const btn = card.querySelector('.view-icon');
        btn.addEventListener('click', () => {
          location.hash = `#/property?prop=${p.id}`;
        });
        cardsWrap.appendChild(card);
      });
      div.appendChild(cardsWrap);
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  return wrap;
}
