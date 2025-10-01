export function initTopbar() {
  const bar = document.getElementById('topbar');
  bar.innerHTML = `
    <div class="logo">Cascade AI</div>
    <div class="tabs">
      <span class="tab" data-route="#/sourcing">Sourcing</span>
      <span class="tab" data-route="#/leads">Leads</span>
      <span class="tab" data-route="#/emails">Emails</span>
    </div>
    <div class="right">
      <select id="filter-select">
        <option value="all">All</option>
        <option value="sale">For Sale</option>
        <option value="rent">For Rent</option>
      </select>
      <button id="logout-btn" type="button" aria-label="Logout">Logout</button>
      <span id="user-email" class="username"></span>
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
  const emailEl = bar.querySelector('#user-email');
  if (emailEl && window.aws_amplify?.Auth) {
    window.aws_amplify.Auth.currentAuthenticatedUser()
      .then(u => {
        const email = u?.attributes?.email;
        if (email) emailEl.textContent = email;
        else emailEl.remove();
      })
      .catch(() => emailEl.remove());
  }
  return { setActive: (route)=> {
    bar.querySelectorAll('.tab').forEach(t=>{
      if(t.dataset.route===route) t.classList.add('active');
      else t.classList.remove('active');
    });
  }};
}
