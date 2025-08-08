export function initTopbar() {
  const bar = document.getElementById('topbar');
  bar.innerHTML = `
    <div class="logo">EstateAI</div>
    <div class="tabs">
      <span class="tab" data-route="#/sourcing">Sourcing</span>
      <span class="tab" data-route="#/leads">Leads</span>
      <span class="tab" data-route="#/outreach">Outreach</span>
      <span class="tab" data-route="#/agent">Agent</span>
    </div>
    <div class="right">
      <input id="global-search" placeholder="Search" />
      <div class="avatar">⚫</div>
    </div>
  `;
  bar.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>location.hash=t.dataset.route));
  return { setActive: (route)=> {
    bar.querySelectorAll('.tab').forEach(t=>{
      if(t.dataset.route===route) t.classList.add('active');
      else t.classList.remove('active');
    });
  }};
}
