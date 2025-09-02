export function initTopbar() {
  const bar = document.getElementById('topbar');
  bar.innerHTML = `
    <div class="logo">Cascade AI</div>
    <div class="tabs">
      <span class="tab" data-route="#/sourcing">Sourcing</span>
      <span class="tab" data-route="#/leads">Leads</span>
      <span class="tab" data-route="#/outreach">Outreach</span>
      <span class="tab" data-route="#/agent">Agent</span>
    </div>
    <div class="right">
      <input id="global-search" placeholder="Search" />
      <select id="sort-select">
        <option value="">Sort</option>
        <option value="price-asc">Price ↑</option>
        <option value="price-desc">Price ↓</option>
        <option value="beds-asc">Beds ↑</option>
        <option value="beds-desc">Beds ↓</option>
      </select>
      <select id="filter-select">
        <option value="all">All</option>
        <option value="sale">For Sale</option>
        <option value="rent">For Rent</option>
      </select>
      <button id="logout-btn" type="button" aria-label="Logout">Logout</button>
      <span id="user-name" class="username"></span>
      <div class="avatar">⚫</div>
    </div>
  `;
  bar.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>location.hash=t.dataset.route));
  async function handleLogout() {
    try {
      await window.aws_amplify.Auth.signOut();
    } catch (_) {}
    window.location.href = 'signin.html';
  }

  const logoutBtn = bar.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  const nameEl = bar.querySelector('#user-name');
  if (nameEl && window.aws_amplify?.Auth) {
    window.aws_amplify.Auth.currentAuthenticatedUser()
      .then(u => {
        nameEl.textContent = u?.attributes?.name || u?.username || '';
      })
      .catch(() => nameEl.remove());
  }
  return { setActive: (route)=> {
    bar.querySelectorAll('.tab').forEach(t=>{
      if(t.dataset.route===route) t.classList.add('active');
      else t.classList.remove('active');
    });
  }};
}
