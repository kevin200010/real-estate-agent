export function createAgentChat() {
  const wrap = document.createElement('div');
  wrap.className = 'agent-chat';
  wrap.innerHTML = `
    <div class="chat-box">
      <div id="chat-messages" class="chat-messages"></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" placeholder="Ask about properties..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `;

  const form = wrap.querySelector('#chat-form');
  const input = wrap.querySelector('#chat-input');
  const messages = wrap.querySelector('#chat-messages');

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
        body: JSON.stringify({ text: text })
      });
      const data = await resp.json();
      addMessage('bot', data.answer || 'No reply');
    } catch (err) {
      addMessage('bot', 'Error contacting server');
    }
  });

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  return wrap;
}
