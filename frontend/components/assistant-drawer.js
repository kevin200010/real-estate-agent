let drawer;
export function initAssistantDrawer() {
  drawer = document.getElementById('assistant');
  drawer.innerHTML = `
    <h3>Assistant</h3>
    <p id="assistant-content">Context-aware tips appear here.</p>
    <div class="actions">
      <button>Refresh</button>
      <button>Suggest</button>
    </div>
  `;
}
export function toggleAssistant() {
  drawer.classList.toggle('hidden');
}
