const API_URL = 'http://localhost:8000';
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic');
const chatWindow = document.getElementById('chatWindow');
const audioEl = document.getElementById('audio');

function appendMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;
  msg.textContent = text;
  chatWindow.appendChild(msg);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

sendBtn.onclick = async () => {
  const text = chatInput.value.trim();
  if (!text) return;
  appendMessage(text, 'user');
  chatInput.value = '';
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  if (data.answer) appendMessage(data.answer, 'bot');
  if (data.audio) {
    audioEl.src = `data:audio/wav;base64,${data.audio}`;
    audioEl.play();
  }
};

let mediaRecorder;
let audioChunks = [];

micBtn.onclick = async () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];
      const res = await fetch(`${API_URL}/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/webm' },
        body: blob
      });
      const data = await res.json();
      if (data.transcript) appendMessage(data.transcript, 'user');
      if (data.answer) appendMessage(data.answer, 'bot');
      if (data.audio) {
        audioEl.src = `data:audio/wav;base64,${data.audio}`;
        audioEl.play();
      }
    };
    mediaRecorder.start();
    micBtn.textContent = 'Stop';
  } else {
    mediaRecorder.stop();
    micBtn.textContent = '🎙️';
  }
};
