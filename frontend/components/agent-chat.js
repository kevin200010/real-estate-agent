const history = [];

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

  // Render any previous chat history
  history.forEach(m => renderMessage(m));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    try {
      const resp = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await resp.json();
      addMessage('bot', data.reply || data.answer || 'No reply', data.properties);
    } catch (err) {
      addMessage('bot', 'Error contacting server');
    }
  });

  function addMessage(role, text, properties = []) {
    const msg = { role, text, properties };
    history.push(msg);
    renderMessage(msg);
  }

  function renderMessage({ role, text, properties }) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre-wrap';
    div.appendChild(span);

    if (Array.isArray(properties) && properties.length) {
      const list = document.createElement('div');
      list.className = 'prop-cards';
      properties.forEach(p => {
        const card = document.createElement('div');
        card.className = 'prop-card';
        card.innerHTML = `<strong>${p.address || ''}</strong><br/>${p.price || ''}<br/>${p.description || ''}`;
        if (p.id) {
          card.addEventListener('click', () => {
            location.hash = `#/sourcing?prop=${p.id}`;
          });
        }
        list.appendChild(card);
      });
      div.appendChild(list);
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  return wrap;
}
