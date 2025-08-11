import { skeletonRow } from './skeleton.js';

export function createDataGrid(props = [], onSelect) {
  const el = document.createElement('div');
  el.id = 'grid';
  const sk = document.createElement('div');
  for (let i = 0; i < 5; i++) sk.appendChild(skeletonRow());
  el.appendChild(sk);
  setTimeout(() => render(), 800);
  function render() {
    el.innerHTML =
      `<table class="data"><thead><tr><th>Address</th><th>Price</th></tr></thead><tbody>` +
      props
        .map(
          (p) =>
            `<tr data-prop-id="${p.id}"><td>${p.address}</td><td>${p.price}</td></tr>`
        )
        .join('') +
      `</tbody></table>`;
  }
  el.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-prop-id]');
    if (!row) return;
    if (onSelect) onSelect(row.dataset.propId);
  });
  return el;
}
