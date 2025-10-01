import { skeletonRow } from './skeleton.js';

// Creates a data grid for property listings. Supports sorting via header click
// and exposes an update method so callers can refresh the rendered data.
export function createDataGrid(props = [], handlers = {}) {
  const el = document.createElement('div');
  el.id = 'grid';

  // Internal state
  let data = [...props];
  let sortKey = null;
  let sortAsc = true;
  const { onSelect, onRemove, onRestore } = handlers;

  const sk = document.createElement('div');
  for (let i = 0; i < 5; i++) sk.appendChild(skeletonRow());
  el.appendChild(sk);

  // Render the table
  function render() {
    // Build header with sort metadata
    const header =
      '<table class="data"><thead><tr>' +
      '<th data-sort="address">Address</th>' +
      '<th data-sort="price">Price</th>' +
      '<th data-sort="beds">Beds</th>' +
      '<th data-sort="baths">Baths</th>' +
      '<th data-sort="year">Year</th>' +
      '<th data-sort="status">Status</th>' +
      '<th data-sort="type">Type</th>' +
      '<th data-sort="saleOrRent">Sale/Rent</th>' +
      '<th data-sort="inSystem">System</th>' +
      '<th>Actions</th>' +
      '</tr></thead><tbody>';

    const rows = data
      .map(
        (p) =>
          `<tr data-prop-id="${p.id}" class="${p.inSystem ? '' : 'removed'}">` +
            `<td>${p.address}</td>` +
            `<td>${p.price || ''}</td>` +
            `<td>${p.beds ?? ''}</td>` +
            `<td>${p.baths ?? ''}</td>` +
            `<td>${p.year ?? ''}</td>` +
            `<td>${p.status || ''}</td>` +
            `<td>${p.type || ''}</td>` +
            `<td>${p.saleOrRent || ''}</td>` +
            `<td>${p.inSystem ? 'In System' : 'Not in System'}</td>` +
            `<td class="actions">` +
              `<button class="view-details" data-id="${p.id}">View</button>` +
              `${p.inSystem ? `<button class="remove-listing" data-id="${p.id}">Remove</button>` : `<button class="restore-listing" data-id="${p.id}">Restore</button>`}` +
            `</td>` +
          `</tr>`
      )
      .join('');

    el.innerHTML = header + rows + '</tbody></table>';

    // Attach event handlers after rendering
    const thead = el.querySelector('thead');
    if (thead) {
      thead.addEventListener('click', onSortClick);
    }
  }

  // Handle sorting when clicking header cells
  function onSortClick(e) {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
    sortData();
    render();
  }

  // Programmatic sorting for external controls
  function setSort(key = null, asc = true) {
    sortKey = key;
    sortAsc = asc;
  }

  // Sort data array based on current sort state
  function sortData() {
    if (!sortKey) return;
    data.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];

      // Attempt numeric comparison when possible (e.g., price)
      const na = parseFloat(String(va).replace(/[^0-9.-]+/g, ''));
      const nb = parseFloat(String(vb).replace(/[^0-9.-]+/g, ''));
      if (!isNaN(na) && !isNaN(nb)) {
        return sortAsc ? na - nb : nb - na;
      }

      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  // Public method for updating the grid's data (e.g., after filtering)
  function update(newProps = []) {
    data = [...newProps];
    sortData();
    render();
  }

  // Initial render after skeleton delay
  setTimeout(() => update(props), 800);

  // Selection handler
  el.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const actionButton = target.closest('button');
    const row = target.closest('tr[data-prop-id]');
    if (!row) return;
    const propId = row.dataset.propId;
    if (!propId) return;

    if (actionButton?.classList.contains('view-details')) {
      e.stopPropagation();
      location.hash = `#/property?prop=${propId}`;
      return;
    }

    if (actionButton?.classList.contains('remove-listing')) {
      e.stopPropagation();
      if (typeof onRemove === 'function') onRemove(propId);
      return;
    }

    if (actionButton?.classList.contains('restore-listing')) {
      e.stopPropagation();
      if (typeof onRestore === 'function') onRestore(propId);
      return;
    }

    if (onSelect) onSelect(propId);
  });

  return { el, update, setSort };
}
