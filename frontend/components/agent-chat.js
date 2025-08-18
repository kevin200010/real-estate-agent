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
        // Send both "text" and "message" keys so the request works with
        // either chat API implementation.  Older versions of the backend
        // expect a ``message`` field while newer ones look for ``text``.
        body: JSON.stringify({ text, message: text })
      });
      const data = await resp.json();
      const sqlText = data.sql_reply ? JSON.stringify(data.sql_reply, null, 2) : (data.reply || data.answer || 'No reply');
      addMessage('bot', sqlText);
    } catch (err) {
      addMessage('bot', 'Error contacting server');
    }
  });

  function addMessage(role, text) {
    const msg = { role, text };
    renderMessage(msg);
  }

  function renderMessage({ role, text }) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre-wrap';
    div.appendChild(span);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  return wrap;
}
