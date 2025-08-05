const API_URL = 'http://localhost:8000';
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic');
const responseDiv = document.getElementById('response');
const audioEl = document.getElementById('audio');

sendBtn.onclick = async () => {
  const text = chatInput.value.trim();
  if (!text) return;
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  responseDiv.textContent = data.answer || '';
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
      let text = '';
      if (data.transcript) text += `You: ${data.transcript}\n`;
      if (data.answer) text += `Bot: ${data.answer}`;
      responseDiv.textContent = text;
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
