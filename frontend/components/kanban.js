import { skeletonCard } from './skeleton.js';
import { showToast } from './toast.js';

let stages = ['New', 'Contacted', 'Qualified', 'Proposal', 'Closed'];

export function createKanban(leads = [], callbacks = {}) {
  const { onAdd, onEdit } = callbacks;
  const board = document.createElement('div');
  board.className = 'kanban';

  const controls = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add Lead';
  addBtn.addEventListener('click', () => {
    if (onAdd) onAdd();
  });
  const addColBtn = document.createElement('button');
  addColBtn.textContent = 'Add Column';
  addColBtn.addEventListener('click', () => {
    const name = prompt('Column name?');
    if (name) {
      stages.push(name);
      render();
    }
  });
  controls.appendChild(addBtn);
  controls.appendChild(addColBtn);
  board.appendChild(controls);

  let columns = {};

  // Initial skeleton
  stages.forEach((s) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.stage = s;
    col.innerHTML = `<h3>${s}</h3>`;
    const sk = document.createElement('div');
    for (let i = 0; i < 3; i++) sk.appendChild(skeletonCard());
    col.appendChild(sk);
    board.appendChild(col);
    columns[s] = col;
  });

  setTimeout(() => render(), 800);

  function render() {
    // Remove existing columns
    Object.values(columns).forEach((c) => c.remove());
    columns = {};
    stages.forEach((s) => {
      const col = document.createElement('div');
      col.className = 'kanban-column';
      col.dataset.stage = s;
      const header = document.createElement('div');
      header.className = 'col-header';
      const title = document.createElement('h3');
      title.textContent = s;
      header.appendChild(title);
      const rename = document.createElement('button');
      rename.textContent = '✎';
      rename.addEventListener('click', () => {
        const newName = prompt('Column name', s);
        if (newName && newName !== s) {
          stages[stages.indexOf(s)] = newName;
          leads
            .filter((l) => l.stage === s)
            .forEach((l) => {
              l.stage = newName;
              if (onEdit) onEdit(l);
            });
          render();
        }
      });
      const remove = document.createElement('button');
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        if (confirm('Remove column?')) {
          stages = stages.filter((x) => x !== s);
          leads
            .filter((l) => l.stage === s)
            .forEach((l) => {
              l.stage = 'New';
              if (onEdit) onEdit(l);
            });
          render();
        }
      });
      header.appendChild(rename);
      header.appendChild(remove);
      col.appendChild(header);
      col.addEventListener('dragover', (e) => e.preventDefault());
      col.addEventListener('drop', (e) => {
        const id = e.dataTransfer.getData('id');
        const card = document.getElementById(id);
        col.appendChild(card);
        showToast(`Moved ${card.dataset.name} to ${s}`);
        if (onEdit) {
          const leadId = parseInt(id.replace('lead-', ''));
          onEdit({
            id: leadId,
            name: card.dataset.name,
            stage: s,
            property: card.dataset.property,
            email: card.dataset.email,
            phone: card.dataset.phone,
            listingNumber: card.dataset.listing,
            address: card.dataset.address,
            notes: card.dataset.notes,
          });
        }
      });
      board.appendChild(col);
      columns[s] = col;
    });

    leads.forEach((l) => {
      const stage = columns[l.stage] ? l.stage : stages[0];
      if (stage !== l.stage) {
        l.stage = stage;
        if (onEdit) onEdit(l);
      }
      const card = document.createElement('div');
      card.className = 'lead-card';
      card.draggable = true;
      card.id = 'lead-' + l.id;
      card.dataset.name = l.name;
      card.dataset.property = l.property || '';
      card.dataset.email = l.email || '';
      card.dataset.phone = l.phone || '';
      card.dataset.listing = l.listingNumber || '';
      card.dataset.address = l.address || '';
      card.dataset.notes = l.notes || '';
      card.innerHTML = `<strong>${l.name}</strong>${
        l.property ? `<br/><small>${l.property}</small>` : ''
      }${l.listingNumber ? `<br/><small>${l.listingNumber}</small>` : ''}${
        l.address ? `<br/><small>${l.address}</small>` : ''
      }`;
      card.addEventListener('dragstart', (e) =>
        e.dataTransfer.setData('id', card.id)
      );
      card.addEventListener('dblclick', () => {
        location.hash = `#/leads?edit=${l.id}`;
      });
      columns[stage].appendChild(card);
    });
  }

  return board;
}

