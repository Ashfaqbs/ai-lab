const API_BASE = 'http://localhost:8000';

const containerList = document.getElementById('container-list');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.appendChild(child));
  return node;
}

// Renders **bold** spans and GFM pipe tables — the only markdown the agent's
// system prompt tells it to emit. No innerHTML: every node is built via the
// DOM API so raw model output can never be interpreted as markup.
function renderInline(container, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      container.appendChild(el('strong', { textContent: part.slice(2, -2) }));
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  }
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isSeparatorRow(line) {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function renderMarkdown(container, text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && isSeparatorRow(lines[i + 1] || '')) {
      const headerCells = splitRow(lines[i]);
      const table = el('table', { className: 'md-table' });
      const thead = el('tr', {}, headerCells.map((cell) => el('th', { textContent: cell })));
      table.appendChild(el('thead', {}, [thead]));
      i += 2;
      const tbody = el('tbody');
      while (i < lines.length && isTableRow(lines[i])) {
        const rowCells = splitRow(lines[i]);
        const tr = el('tr');
        rowCells.forEach((cell) => {
          const td = el('td');
          renderInline(td, cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
        i += 1;
      }
      table.appendChild(tbody);
      container.appendChild(table);
      continue;
    }

    const p = el('p');
    renderInline(p, lines[i]);
    container.appendChild(p);
    i += 1;
  }
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;
  if (role === 'agent') {
    renderMarkdown(div, text);
  } else {
    div.textContent = text;
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function renderActionCard(action) {
  const card = el('div', { className: 'action-card', 'data-action-id': action.action_id });

  const summary = el('p', {}, [
    el('strong', { textContent: action.action_type.toUpperCase() }),
    document.createTextNode(' container '),
    el('code', { textContent: action.container_id }),
  ]);
  const description = el('p', { textContent: action.description });
  const status = el('div', { className: 'action-card-status' });
  const buttons = el('div', { className: 'action-card-buttons' }, [
    el('button', { type: 'button', className: 'approve-btn', textContent: 'Approve' }),
    el('button', { type: 'button', className: 'reject-btn', textContent: 'Reject' }),
  ]);

  card.append(summary, description, status, buttons);
  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;
}

// Event delegation: buttons are looked up at click time, so there is no
// stale closure or race with re-renders — clicking always targets the
// action_id that is actually on the card in the DOM right now.
messages.addEventListener('click', async (e) => {
  const card = e.target.closest('.action-card');
  if (!card) return;
  const actionId = card.dataset.actionId;

  if (e.target.classList.contains('approve-btn')) {
    await resolveAction(card, actionId, 'approve');
  } else if (e.target.classList.contains('reject-btn')) {
    await resolveAction(card, actionId, 'reject');
  }
});

async function resolveAction(card, actionId, decision) {
  const buttons = card.querySelector('.action-card-buttons');
  const status = card.querySelector('.action-card-status');
  buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
  status.textContent = 'working...';

  try {
    const res = await fetch(`${API_BASE}/actions/${actionId}/${decision}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.detail || `Error: ${res.statusText}`;
      return;
    }
    if (data.status === 'approved') {
      status.textContent = data.result?.success ? 'Done — action completed.' : `Failed — ${data.result?.error}`;
    } else {
      status.textContent = 'Rejected — no changes made.';
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    buttons.remove();
    refreshContainers();
  }
}

async function refreshContainers() {
  try {
    const res = await fetch(`${API_BASE}/containers`);
    const list = await res.json();
    containerList.replaceChildren(
      ...list.map((c) =>
        el('li', {}, [
          el('strong', { textContent: c.name }),
          el('span', { className: `status status-${c.status}`, textContent: c.status }),
          el('div', { className: 'container-image', textContent: c.image }),
        ]),
      ),
    );
  } catch {
    // backend not reachable yet; next poll will retry
  }
}

async function checkPendingAction() {
  try {
    const res = await fetch(`${API_BASE}/actions/pending`);
    const action = await res.json();
    if (action && !document.querySelector(`[data-action-id="${action.action_id}"]`)) {
      renderActionCard(action);
    }
  } catch {
    // ignore, next poll retries
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addMessage('user', text);
  chatInput.value = '';
  await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
});

function connectStream() {
  const source = new EventSource(`${API_BASE}/chat/stream`);

  source.addEventListener('token', (e) => {
    const { text } = JSON.parse(e.data);
    addMessage('agent', text);
  });

  source.addEventListener('pending_action', (e) => {
    const action = JSON.parse(e.data);
    if (!document.querySelector(`[data-action-id="${action.action_id}"]`)) {
      renderActionCard(action);
    }
  });

  source.addEventListener('action_resolved', () => {
    refreshContainers();
  });

  source.onerror = () => {
    // EventSource auto-reconnects; poll for pending actions in case an
    // event was missed while disconnected.
    checkPendingAction();
  };
}

refreshContainers();
checkPendingAction();
connectStream();
setInterval(refreshContainers, 5000);
setInterval(checkPendingAction, 3000);
