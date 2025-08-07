// Basic frontend logic for the chatbot widget
const API_URL = 'http://localhost:8000';

const messagesEl = document.getElementById('chatbot-messages');
const form = document.getElementById('chatbot-form');
const input = document.getElementById('chatbot-input');

// Render text or property card messages
function appendMessage(message, sender) {
  const wrapper = document.createElement('div');
  wrapper.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'}`;

  if (typeof message === 'string') {
    const bubble = document.createElement('div');
    bubble.className = `px-4 py-2 rounded-lg max-w-[75%] text-sm whitespace-pre-wrap ${
      sender === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'
    }`;
    bubble.innerHTML = marked.parse(message);
    wrapper.appendChild(bubble);
  } else if (message.type === 'property') {
    const card = document.createElement('div');
    card.className =
      'w-64 bg-white rounded-lg border shadow-sm overflow-hidden text-left';
    card.innerHTML = `
      <img src="${message.image}" alt="${message.address}" class="h-36 w-full object-cover" />
      <div class="p-3">
        <p class="font-semibold text-gray-800">${message.address}</p>
        <p class="text-blue-600 font-bold">${message.price}</p>
        <p class="text-xs text-gray-600 mt-1">${message.description}</p>
      </div>
    `;
    wrapper.appendChild(card);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  appendMessage(text, 'user');
  input.value = '';

  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();

    if (data.reply) appendMessage(data.reply, 'bot');
    if (Array.isArray(data.properties)) {
      data.properties.forEach((p) =>
        appendMessage({ type: 'property', ...p }, 'bot')
      );
    }
  } catch (err) {
    console.error(err);
    appendMessage('Sorry, something went wrong. Please try again later.', 'bot');
  }
});
