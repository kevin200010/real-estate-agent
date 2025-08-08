export function initLeftRail(data) {
  const rail = document.getElementById('left-rail');
  const list = data.savedSearches || [];
  rail.innerHTML = `
    <button id="collapse-rail">≡</button>
    <div class="filters">
      <div class="chip">For Sale</div>
      <div class="chip">Price &lt; 1M</div>
    </div>
    <div class="saved">
      <h4>Saved Searches</h4>
      <ul>${list.map(s=>`<li class="saved-item">${s}</li>`).join('')}</ul>
    </div>`;
  document.getElementById('collapse-rail').addEventListener('click',()=>rail.classList.toggle('collapsed'));
}
