// Basic frontend logic for the chatbot widget
// Define the backend API URL. This defaults to the local FastAPI server but
// can be overridden by setting `window.API_URL` before this script loads.
const API_URL = window.API_URL || 'http://localhost:8000';

const messagesEl = document.getElementById('chatbot-messages');
const form = document.getElementById('chatbot-form');
const input = document.getElementById('chatbot-input');

// Rotate background images every 30 seconds
const bgImages = [
  'https://images.unsplash.com/photo-1502672023488-70e25813eb80?auto=format&fit=crop&w=1350&q=80',
  'https://images.unsplash.com/photo-1560185127-6c9d8dddb7fb?auto=format&fit=crop&w=1350&q=80',
  'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1350&q=80'
];
let bgIndex = 0;
setInterval(() => {
  bgIndex = (bgIndex + 1) % bgImages.length;
  document.body.style.setProperty('--bg-image', `url('${bgImages[bgIndex]}')`);
}, 30000);

input.focus();

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

// Render an array of property listings as cards
function renderListings(listings) {
  listings.forEach((listing) =>
    appendMessage({ type: 'property', ...listing }, 'bot')
  );
}

// Call the backend `/chat` endpoint and handle the new response shape
async function fetchChatResponse(text) {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }

  const data = await res.json();

  // Display assistant answer
  if (data.answer) {
    appendMessage(data.answer, 'bot');
  } else if (data.message && Array.isArray(data.message.content)) {
    // Fallback for older response format
    data.message.content.forEach((c) =>
      appendMessage(c.text || c, 'bot')
    );
  } else {
    appendMessage('Sorry, something went wrong. Please try again later.', 'bot');
  }

  // Render property listings if present
  if (Array.isArray(data.listings) && data.listings.length) {
    renderListings(data.listings);
  }

  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  appendMessage(text, 'user');
  input.value = '';

  try {
    await fetchChatResponse(text);
  } catch (err) {
    console.error(err);
    appendMessage('Sorry, something went wrong. Please try again later.', 'bot');
  }
});
