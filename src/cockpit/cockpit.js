import { PROVIDERS, DEFAULT_CREW, getProvider } from '../shared/providers.js';
import { PRESETS, getPreset } from '../shared/presets.js';
import { MSG, sendToPane } from '../shared/messaging.js';
import { MAX_ATTACHMENT_BYTES, formatSize, truncateName } from '../shared/attachments.js';

const STATE_KEY = 'multai.state';
const PLANS_KEY = 'multai.plans';
const LIBRARY_KEY = 'multai.library';

const state = {
  crew: [...DEFAULT_CREW],
  selectedPreset: null,
  master: { thinking: 'pane', tools: 'pane' },
  paneSettings: {},
  paneChat: {},
  benchCollapsed: false
};

const panes = {};                 // { [providerId]: { iframe, ready, state } }
let attachments = [];             // File[]
let openChatPickerFor = null;
let library = [];                 // [{ id, name, text }]
let blindMode = false;

const PANE_ORIGINS = new Set(PROVIDERS.map(p => p.origin));

/* ---------- Storage ---------- */

async function loadState() {
  const saved = await chrome.storage.local.get(STATE_KEY);
  if (saved[STATE_KEY]) Object.assign(state, saved[STATE_KEY]);
  // Prune any provider ids that no longer exist (e.g. after a provider is removed)
  const valid = new Set(PROVIDERS.map(p => p.id));
  const before = state.crew.length;
  state.crew = state.crew.filter(id => valid.has(id));
  for (const id of Object.keys(state.paneChat || {})) {
    if (!valid.has(id)) delete state.paneChat[id];
  }
  if (state.crew.length !== before) await saveState();
  render();
}

async function saveState() {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function savePlan(providerId, plan) {
  const saved = await chrome.storage.local.get(PLANS_KEY);
  const plans = saved[PLANS_KEY] || {};
  if (plans[providerId] !== plan) {
    plans[providerId] = plan;
    await chrome.storage.local.set({ [PLANS_KEY]: plans });
  }
}

async function loadLibrary() {
  const saved = await chrome.storage.local.get(LIBRARY_KEY);
  library = saved[LIBRARY_KEY] || [];
}

async function saveLibrary() {
  await chrome.storage.local.set({ [LIBRARY_KEY]: library });
}

/* ---------- Render ---------- */

function render() {
  renderCrew();
  renderPresets();
  renderMaster();
  renderGrid();
  renderBench();
  applyBlindMode();
}

function renderCrew() {
  const el = document.getElementById('crew');
  el.innerHTML = '';
  for (const provider of PROVIDERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crew-item' + (state.crew.includes(provider.id) ? ' is-active' : '');
    btn.textContent = provider.label;
    btn.addEventListener('click', () => toggleCrew(provider.id));
    el.appendChild(btn);
  }
}

function renderPresets() {
  const el = document.getElementById('preset-picker');
  el.innerHTML = '';
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset' + (state.selectedPreset === preset.id ? ' is-selected' : '');
    btn.textContent = preset.label;
    btn.title = preset.description;
    btn.addEventListener('click', () => selectPreset(preset.id));
    el.appendChild(btn);
  }
}

function renderMaster() {
  for (const chip of document.querySelectorAll('.chip[data-master]')) {
    const key = chip.dataset.master;
    const value = chip.dataset.value;
    chip.classList.toggle('is-active', state.master[key] === value);
  }
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  grid.setAttribute('data-count', String(state.crew.length));
  grid.classList.toggle('is-blind', blindMode);

  // Drop pane entries for providers no longer active
  for (const id of Object.keys(panes)) {
    if (!state.crew.includes(id)) delete panes[id];
  }

  if (state.crew.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pane';
    empty.innerHTML = `
      <div class="pane-placeholder">
        <strong>No providers active.</strong>
        <span>Click any name in the Crew row above to activate it.</span>
      </div>
    `;
    grid.appendChild(empty);
    return;
  }

  for (const id of state.crew) {
    const provider = getProvider(id);
    if (provider) grid.appendChild(createPane(provider));
  }
}

function createPane(provider) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.dataset.provider = provider.id;

  const chatLabel = getChatLabel(provider.id);

  pane.innerHTML = `
    <div class="pane-header">
      <div class="pane-title-row">
        <span class="pane-title">${escapeHtml(provider.label)}</span>
        <div class="pane-actions">
          <span class="pane-status" data-role="status">loading</span>
          <button type="button" class="pane-action" data-pane-action="quote" title="Quote current selection from this pane">Quote</button>
          <button type="button" class="pane-action" data-pane-action="reload">Reload</button>
          <button type="button" class="pane-action" data-pane-action="focus">Focus</button>
          <button type="button" class="pane-action" data-pane-action="new-chat">New chat</button>
        </div>
      </div>
      <dl class="pane-settings">
        <dt>Model</dt><dd data-role="model">—</dd>
        <dt>Plan</dt><dd data-role="plan">—</dd>
        <dt>Chat</dt>
        <dd>
          <div class="chat-picker">
            <button type="button" class="chat-picker-btn" data-pane-action="chat-picker">
              <span class="chat-picker-value">${escapeHtml(chatLabel)}</span>
            </button>
          </div>
        </dd>
      </dl>
    </div>
    <div class="pane-body">
      <iframe
        src="${provider.url}"
        title="${escapeHtml(provider.label)}"
        allow="clipboard-read; clipboard-write"
        referrerpolicy="no-referrer-when-downgrade"></iframe>
      <div class="pane-fallback" data-role="fallback" hidden>
        <strong>${escapeHtml(provider.label)} hasn't responded yet.</strong>
        <span>Likely a slow load or site-level iframe refusal. You can open it in a new tab and still use multai's prompt box to broadcast to the other panes.</span>
        <div class="pane-fallback-actions">
          <button type="button" class="btn-ghost" data-pane-action="open-tab">Open in new tab</button>
          <button type="button" class="pane-action" data-pane-action="retry">Retry</button>
        </div>
      </div>
    </div>
  `;

  pane.querySelector('[data-pane-action="quote"]').addEventListener('click', () => quoteFromPane(provider.id));
  pane.querySelector('[data-pane-action="reload"]').addEventListener('click', () => reloadPane(provider.id));
  pane.querySelector('[data-pane-action="focus"]').addEventListener('click', () => focusPane(provider.id));
  pane.querySelector('[data-pane-action="new-chat"]').addEventListener('click', () => newChatOn(provider.id));
  pane.querySelector('[data-pane-action="chat-picker"]').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleChatPicker(provider.id, e.currentTarget);
  });
  pane.querySelector('[data-pane-action="open-tab"]').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'multai:open-in-tab', url: provider.url });
  });
  pane.querySelector('[data-pane-action="retry"]').addEventListener('click', () => reloadPane(provider.id));

  const iframe = pane.querySelector('iframe');
  const fallback = pane.querySelector('[data-role="fallback"]');
  panes[provider.id] = { iframe, fallback, ready: false, state: null };

  if (provider.hasContentScript) {
    // Wake the content script once the iframe has finished loading, and keep
    // waking every 500ms until it reports ready (the content script replies
    // with multai:ready on receipt of multai:wake).
    iframe.addEventListener('load', () => wakePane(provider.id), { once: true });
    startReadyWatchdog(provider.id);
  } else {
    iframe.addEventListener('load', () => {
      const paneEl = document.querySelector(`.pane[data-provider="${provider.id}"]`);
      const statusEl = paneEl?.querySelector('[data-role="status"]');
      if (statusEl) {
        statusEl.textContent = 'manual';
        statusEl.className = 'pane-status is-ready';
      }
    }, { once: true });
  }

  return pane;
}

function wakePane(providerId) {
  const pane = panes[providerId];
  const provider = getProvider(providerId);
  if (!pane || !pane.iframe || !provider) return;

  const targetOrigins = [provider.origin, ...(provider.altOrigins || [])];
  const send = () => {
    const cw = pane.iframe.contentWindow;
    if (!cw) return;
    for (const origin of targetOrigins) {
      try { cw.postMessage({ type: 'multai:wake' }, origin); } catch (_) {}
    }
  };

  send();
  const interval = setInterval(() => {
    if (!panes[providerId] || panes[providerId].ready) {
      clearInterval(interval);
      return;
    }
    send();
  }, 500);
  setTimeout(() => clearInterval(interval), 25000);
}

function startReadyWatchdog(providerId) {
  const pane = panes[providerId];
  if (!pane) return;
  if (pane.watchdog) clearTimeout(pane.watchdog);
  pane.watchdog = setTimeout(() => {
    if (!pane.ready && pane.fallback) {
      pane.fallback.hidden = false;
      pane.iframe.style.opacity = '0.15';
      const paneEl = document.querySelector(`.pane[data-provider="${providerId}"]`);
      const statusEl = paneEl?.querySelector('[data-role="status"]');
      if (statusEl) {
        statusEl.textContent = 'silent';
        statusEl.className = 'pane-status';
      }
    }
  }, 20000);
}

function getChatLabel(providerId) {
  const chat = state.paneChat[providerId];
  if (!chat || chat === 'new') return 'New';
  const paneState = panes[providerId]?.state;
  const thread = paneState?.threads?.find(t => t.id === chat);
  return thread?.title || 'Resumed';
}

function updatePaneHeader(providerId) {
  const pane = panes[providerId];
  const paneEl = document.querySelector(`.pane[data-provider="${providerId}"]`);
  if (!pane || !paneEl) return;

  const statusEl = paneEl.querySelector('[data-role="status"]');
  const modelEl = paneEl.querySelector('[data-role="model"]');
  const planEl = paneEl.querySelector('[data-role="plan"]');
  const paneState = pane.state;

  if (!pane.ready) {
    statusEl.textContent = 'loading';
    statusEl.className = 'pane-status';
  } else if (paneState?.generating) {
    statusEl.textContent = 'generating';
    statusEl.className = 'pane-status is-generating';
  } else if (paneState?.ready) {
    statusEl.textContent = 'ready';
    statusEl.className = 'pane-status is-ready';
  } else {
    statusEl.textContent = 'signed out?';
    statusEl.className = 'pane-status';
  }

  modelEl.textContent = paneState?.currentModel || '—';
  planEl.textContent = paneState?.plan || '—';
}

function renderBench() {
  const el = document.getElementById('bench');
  el.innerHTML = '';
  const bench = PROVIDERS.filter(p => !state.crew.includes(p.id));
  if (bench.length === 0) {
    el.classList.remove('is-collapsed');
    return;
  }

  const collapsed = !!state.benchCollapsed;
  el.classList.toggle('is-collapsed', collapsed);

  const header = document.createElement('div');
  header.className = 'bench-header';

  const label = document.createElement('span');
  label.className = 'bench-label';
  label.textContent = 'Bench';
  header.appendChild(label);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'bench-toggle';
  toggle.setAttribute('aria-label', collapsed ? 'Expand bench' : 'Collapse bench');
  toggle.title = collapsed ? 'Expand bench' : 'Collapse bench';
  toggle.textContent = collapsed ? '‹' : '›';
  toggle.addEventListener('click', () => {
    state.benchCollapsed = !state.benchCollapsed;
    saveState();
    renderBench();
  });
  header.appendChild(toggle);

  el.appendChild(header);

  for (const provider of bench) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bench-item';
    btn.textContent = provider.label;
    btn.title = `Activate ${provider.label}`;
    btn.addEventListener('click', () => toggleCrew(provider.id));
    el.appendChild(btn);
  }
}

/* ---------- Actions ---------- */

function toggleCrew(id) {
  state.crew = state.crew.includes(id)
    ? state.crew.filter(x => x !== id)
    : [...state.crew, id];
  saveState();
  render();
}

function selectPreset(id) {
  state.selectedPreset = state.selectedPreset === id ? null : id;
  saveState();
  renderPresets();
}

function setMaster(key, value) {
  state.master[key] = value;
  saveState();
  renderMaster();
}

function reloadPane(providerId) {
  const p = panes[providerId];
  if (!p) return;
  p.ready = false;
  p.state = null;
  if (p.fallback) p.fallback.hidden = true;
  if (p.iframe) p.iframe.style.opacity = '';
  updatePaneHeader(providerId);
  p.iframe.addEventListener('load', () => wakePane(providerId), { once: true });
  p.iframe.src = p.iframe.src;
  const provider = getProvider(providerId);
  if (provider?.hasContentScript) startReadyWatchdog(providerId);
}

function focusPane(providerId) {
  state.crew = [providerId];
  saveState();
  render();
}

async function newChatOn(providerId) {
  state.paneChat[providerId] = 'new';
  await saveState();
  updateChatLabel(providerId);
  const pane = panes[providerId];
  const provider = getProvider(providerId);
  if (!pane?.ready) {
    if (pane) pane.iframe.src = provider.url;
    return;
  }
  try {
    await sendToPane(pane.iframe, provider.origin, { type: MSG.NEW_CHAT });
  } catch (_) {
    pane.iframe.src = provider.url;
  }
}

function updateChatLabel(providerId) {
  const paneEl = document.querySelector(`.pane[data-provider="${providerId}"]`);
  if (!paneEl) return;
  const valueEl = paneEl.querySelector('.chat-picker-value');
  if (valueEl) valueEl.textContent = getChatLabel(providerId);
}

function toggleChatPicker(providerId, button) {
  if (openChatPickerFor === providerId) {
    closeChatPicker();
    return;
  }
  closeChatPicker();
  openChatPickerFor = providerId;

  const paneState = panes[providerId]?.state;
  const threads = paneState?.threads || [];
  const current = state.paneChat[providerId] || 'new';

  const menu = document.createElement('div');
  menu.className = 'chat-picker-menu';

  const addItem = (label, id) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (id === current) btn.classList.add('is-active');
    btn.addEventListener('click', async () => {
      closeChatPicker();
      state.paneChat[providerId] = id;
      await saveState();
      updateChatLabel(providerId);
      const pane = panes[providerId];
      const provider = getProvider(providerId);
      if (!pane) return;
      try {
        await sendToPane(pane.iframe, provider.origin, { type: MSG.SET_CHAT, chatId: id });
      } catch (err) {
        showBanner(`Could not switch chat in ${provider.label}: ${err.message}`);
      }
    });
    menu.appendChild(btn);
  };

  addItem('New chat', 'new');

  if (threads.length) {
    const divider = document.createElement('div');
    divider.className = 'menu-divider';
    menu.appendChild(divider);
    for (const t of threads) addItem(t.title || 'Untitled', t.id);
  } else {
    const empty = document.createElement('div');
    empty.className = 'menu-empty';
    empty.textContent = panes[providerId]?.ready
      ? 'No recent chats detected.'
      : 'Waiting for pane to finish loading…';
    menu.appendChild(empty);
  }

  button.parentElement.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeChatPickerOnOutside, { once: true }), 0);
}

function closeChatPicker() {
  const menu = document.querySelector('.chat-picker-menu');
  if (menu) menu.remove();
  openChatPickerFor = null;
}

function closeChatPickerOnOutside(e) {
  if (e.target.closest('.chat-picker-menu')) return;
  closeChatPicker();
}

/* ---------- Attachments ---------- */

function renderAttachments() {
  const el = document.getElementById('attachments');
  el.innerHTML = '';
  if (attachments.length === 0) { el.hidden = true; return; }
  el.hidden = false;
  attachments.forEach((file, index) => {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    chip.innerHTML = `
      <span class="name">${escapeHtml(truncateName(file.name))}</span>
      <span class="size">${formatSize(file.size)}</span>
      <button type="button" class="remove" aria-label="Remove ${escapeHtml(file.name)}">×</button>
    `;
    chip.querySelector('.remove').addEventListener('click', () => {
      attachments.splice(index, 1);
      renderAttachments();
    });
    el.appendChild(chip);
  });
}

function addFiles(list) {
  const add = [];
  for (const f of list) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      showBanner(`${f.name} is ${formatSize(f.size)} — over the 32 MB per-file cap.`);
      continue;
    }
    add.push(f);
  }
  if (add.length) {
    attachments = [...attachments, ...add];
    renderAttachments();
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Broadcast ---------- */

/* ---------- Prompt library ---------- */

function openLibrary() {
  renderLibrary();
  const popup = document.getElementById('library-popup');
  popup.hidden = false;
  setTimeout(() => document.addEventListener('click', closeLibraryOnOutside, { once: true }), 0);
}

function closeLibrary() {
  document.getElementById('library-popup').hidden = true;
}

function closeLibraryOnOutside(e) {
  const popup = document.getElementById('library-popup');
  const trigger = document.getElementById('library-btn');
  if (popup.hidden) return;
  if (popup.contains(e.target) || (trigger && trigger.contains(e.target))) {
    setTimeout(() => document.addEventListener('click', closeLibraryOnOutside, { once: true }), 0);
    return;
  }
  closeLibrary();
}

function renderLibrary() {
  const list = document.getElementById('library-list');
  list.innerHTML = '';
  if (library.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'library-empty';
    empty.textContent = 'No saved prompts yet. Type one above and click "Save current".';
    list.appendChild(empty);
    return;
  }
  for (const entry of library) {
    const li = document.createElement('li');
    li.className = 'library-item';
    const preview = entry.text.length > 160 ? entry.text.slice(0, 160) + '…' : entry.text;
    li.innerHTML = `
      <div class="library-item-name">${escapeHtml(entry.name)}</div>
      <div class="library-item-text">${escapeHtml(preview)}</div>
      <div class="library-item-actions">
        <button type="button" class="link" data-lib-action="insert">Insert</button>
        <button type="button" class="link" data-lib-action="delete">Delete</button>
      </div>
    `;
    li.querySelector('[data-lib-action="insert"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      insertFromLibrary(entry);
    });
    li.querySelector('[data-lib-action="delete"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      library = library.filter(x => x.id !== entry.id);
      await saveLibrary();
      renderLibrary();
    });
    li.addEventListener('click', () => insertFromLibrary(entry));
    list.appendChild(li);
  }
}

function insertFromLibrary(entry) {
  const el = document.getElementById('prompt');
  el.value = entry.text;
  el.focus();
  closeLibrary();
}

async function saveCurrentPromptToLibrary() {
  const text = document.getElementById('prompt').value.trim();
  if (!text) { showBanner('Prompt is empty — nothing to save.'); return; }
  const name = window.prompt('Name this prompt:', text.slice(0, 40));
  if (!name) return;
  library = [{ id: Date.now().toString(36), name: name.trim(), text }, ...library];
  await saveLibrary();
  renderLibrary();
  showBanner(`Saved "${name.trim()}" to library.`);
}

/* ---------- Blind mode ---------- */

function toggleBlind() {
  blindMode = !blindMode;
  applyBlindMode();
}

function applyBlindMode() {
  const grid = document.getElementById('grid');
  grid.classList.toggle('is-blind', blindMode);
  const btn = document.getElementById('blind-toggle');
  if (btn) {
    btn.classList.toggle('is-active', blindMode);
    btn.textContent = `Blind mode · ${blindMode ? 'on' : 'off'}`;
  }
  const paneEls = grid.querySelectorAll('.pane[data-provider]');
  paneEls.forEach((p, i) => {
    const title = p.querySelector('.pane-title');
    if (title) title.setAttribute('data-blind-label', String.fromCharCode(65 + i));
  });
}

/* ---------- Compare drawer ---------- */

async function openCompare() {
  const drawer = document.getElementById('compare-drawer');
  drawer.hidden = false;
  await refreshCompare();
}

function closeCompare() {
  document.getElementById('compare-drawer').hidden = true;
}

async function refreshCompare() {
  const body = document.getElementById('compare-body');
  body.innerHTML = '<div class="compare-loading">Reading responses from each pane…</div>';

  const ready = state.crew.filter(id => getProvider(id) && panes[id]?.ready);
  if (ready.length === 0) {
    body.innerHTML = '<div class="compare-empty">No ready panes to compare. Wait for panes to load, then send a prompt.</div>';
    return;
  }

  const results = await Promise.allSettled(
    ready.map(async id => {
      const provider = getProvider(id);
      const pane = panes[id];
      const res = await sendToPane(pane.iframe, provider.origin, { type: MSG.READ_LAST }, { timeoutMs: 6000 });
      return { id, text: res.text || '', html: res.html || '' };
    })
  );

  body.innerHTML = '';
  results.forEach((r, i) => {
    const id = ready[i];
    const provider = getProvider(id);
    const col = document.createElement('div');
    col.className = 'compare-column';
    const label = blindMode ? String.fromCharCode(65 + i) : provider.label;
    const text = r.status === 'fulfilled' ? (r.value.text || '') : '';
    const error = r.status === 'rejected' ? String(r.reason?.message || r.reason) : null;
    col.innerHTML = `
      <div class="compare-col-header">
        <span class="compare-col-name">${escapeHtml(label)}</span>
        <button type="button" class="link" data-compare-action="copy">Copy</button>
      </div>
      ${error
        ? `<div class="compare-col-error">Could not read: ${escapeHtml(error)}</div>`
        : `<div class="compare-col-text"></div>`}
    `;
    if (!error) {
      col.querySelector('.compare-col-text').textContent = text || '(empty)';
    }
    col.querySelector('[data-compare-action="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        showBanner(`${label} copied.`);
      } catch (_) {
        showBanner('Copy failed — browser blocked clipboard access.');
      }
    });
    body.appendChild(col);
  });
}

function exportCompareMarkdown() {
  const cols = document.querySelectorAll('#compare-body .compare-column');
  if (cols.length === 0) { showBanner('Nothing to export yet.'); return; }
  const promptText = document.getElementById('prompt').value.trim();
  const now = new Date();
  let md = `# MultAI comparison — ${now.toLocaleString()}\n\n`;
  if (promptText) md += `## Prompt\n\n${promptText}\n\n`;
  for (const col of cols) {
    const name = col.querySelector('.compare-col-name')?.textContent || 'Pane';
    const text = col.querySelector('.compare-col-text')?.textContent
              || col.querySelector('.compare-col-error')?.textContent
              || '';
    md += `## ${name}\n\n${text}\n\n---\n\n`;
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `multai-compare-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Cross-pane quote ---------- */

async function quoteFromPane(providerId) {
  const pane = panes[providerId];
  const provider = getProvider(providerId);
  if (!provider) return;
  if (!pane?.ready) { showBanner(`${provider.label} isn't ready yet.`); return; }
  try {
    const res = await sendToPane(pane.iframe, provider.origin, { type: MSG.READ_SELECTION }, { timeoutMs: 3000 });
    const text = (res.text || '').trim();
    if (!text) { showBanner(`Nothing selected in ${provider.label}.`); return; }
    const label = blindMode ? 'Pane' : provider.label;
    const promptEl = document.getElementById('prompt');
    const prefix = promptEl.value.trim() ? promptEl.value.trimEnd() + '\n\n' : '';
    const quoted = text.split('\n').map(l => `> ${l}`).join('\n');
    promptEl.value = `${prefix}${label} said:\n${quoted}\n\n`;
    promptEl.focus();
    promptEl.scrollTop = promptEl.scrollHeight;
  } catch (err) {
    showBanner(`Quote failed for ${provider.label}: ${err.message || err}`);
  }
}

let isBroadcasting = false;

async function broadcast() {
  if (isBroadcasting) return;
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('send');
  const prompt = promptEl.value.trim();
  if (!prompt && attachments.length === 0) return;

  const active = state.crew.filter(id => getProvider(id));
  const ready = active.filter(id => panes[id]?.ready);
  const pending = active.filter(id => !panes[id]?.ready);

  isBroadcasting = true;
  sendBtn.classList.add('is-sending');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  const restore = () => {
    isBroadcasting = false;
    sendBtn.classList.remove('is-sending');
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  };

  if (ready.length === 0) {
    showBanner('No panes are ready yet. Wait for each site to finish loading (and sign in where needed).');
    restore();
    return;
  }
  if (pending.length) {
    showBanner(`Broadcasting to ${ready.length}; ${pending.map(id => getProvider(id).label).join(', ')} not ready yet.`, 3200);
  }

  // Snapshot the current attachments so the user can keep editing the next prompt
  const files = attachments.slice();

  const results = await Promise.allSettled(
    ready.map(async id => {
      const provider = getProvider(id);
      const pane = panes[id];
      await sendToPane(pane.iframe, provider.origin, {
        type: MSG.BROADCAST,
        payload: { prompt, files }
      }, { timeoutMs: 120000 });
      return id;
    })
  );

  const failures = results
    .map((r, i) => ({ r, id: ready[i] }))
    .filter(x => x.r.status === 'rejected')
    .map(x => `${getProvider(x.id).label}: ${x.r.reason?.message || x.r.reason}`);

  if (failures.length) {
    showBanner('Some panes failed — ' + failures.join(' · '), 6000);
  } else {
    promptEl.value = '';
    attachments = [];
    renderAttachments();
  }

  for (const id of ready) probePane(id);
  restore();
}

async function probePane(providerId) {
  const pane = panes[providerId];
  if (!pane?.ready) return;
  const provider = getProvider(providerId);
  try {
    const res = await sendToPane(pane.iframe, provider.origin, { type: MSG.PROBE }, { timeoutMs: 5000 });
    pane.state = res.state;
    updatePaneHeader(providerId);
    if (res.state?.plan && res.state.plan !== 'Unknown') savePlan(providerId, res.state.plan);
  } catch (err) {
    console.warn('[multai] probe failed for', providerId, err);
  }
}

/* ---------- Message routing ---------- */

function originMatchesProvider(messageOrigin, provider) {
  const origins = [provider.origin, ...(provider.altOrigins || [])];
  for (const orig of origins) {
    try {
      const msg = new URL(messageOrigin).hostname;
      const prov = new URL(orig).hostname;
      const base = prov.replace(/^www\./, '');
      if (msg === prov || msg === base || msg.endsWith('.' + base)) return true;
    } catch (_) { /* try next */ }
  }
  return false;
}

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (typeof data.type !== 'string' || !data.type.startsWith('multai:')) return;

  let providerId = data.provider;
  if (!providerId) {
    for (const [id, pane] of Object.entries(panes)) {
      if (e.source === pane.iframe?.contentWindow) { providerId = id; break; }
    }
  }
  if (!providerId || !panes[providerId]) return;

  const provider = getProvider(providerId);
  if (!provider) return;
  if (!originMatchesProvider(e.origin, provider)) {
    console.debug('[multai] origin outside provider domain — ignoring', providerId, e.origin);
    return;
  }

  console.debug('[multai] pane message', providerId, data.type);
  onPaneMessage(providerId, data);
});

function onPaneMessage(providerId, data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === MSG.READY) {
    const pane = panes[providerId];
    if (!pane) return;
    pane.ready = true;
    if (pane.watchdog) { clearTimeout(pane.watchdog); pane.watchdog = null; }
    if (pane.fallback) pane.fallback.hidden = true;
    if (pane.iframe) pane.iframe.style.opacity = '';
    updatePaneHeader(providerId);
    setTimeout(() => probePane(providerId), 600);
  }
}

/* ---------- Event wiring ---------- */

document.getElementById('send').addEventListener('click', broadcast);

const promptEl = document.getElementById('prompt');
promptEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    broadcast();
  }
});

promptEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

const promptArea = document.getElementById('prompt-area');
promptArea.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  promptArea.classList.add('is-dragging');
});
promptArea.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
});
promptArea.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && promptArea.contains(e.relatedTarget)) return;
  promptArea.classList.remove('is-dragging');
});
promptArea.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  promptArea.classList.remove('is-dragging');
  addFiles(e.dataTransfer.files);
});

document.getElementById('attach-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files?.length) addFiles(e.target.files);
  e.target.value = '';
});

document.querySelector('[data-action="apply-preset"]').addEventListener('click', () => {
  if (!state.selectedPreset) return;
  const preset = getPreset(state.selectedPreset);
  showBanner(`"${preset.label}" — per-provider setter wiring comes in step 2.5.`);
});

document.querySelector('[data-action="open-settings"]').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

for (const chip of document.querySelectorAll('.chip[data-master]')) {
  chip.addEventListener('click', () => setMaster(chip.dataset.master, chip.dataset.value));
}

document.querySelector('[data-action="compare"]')?.addEventListener('click', openCompare);

document.getElementById('library-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const popup = document.getElementById('library-popup');
  if (popup.hidden) openLibrary(); else closeLibrary();
});
document.getElementById('library-save').addEventListener('click', saveCurrentPromptToLibrary);
document.getElementById('library-close').addEventListener('click', closeLibrary);

document.getElementById('blind-toggle').addEventListener('click', toggleBlind);

document.getElementById('compare-refresh').addEventListener('click', refreshCompare);
document.getElementById('compare-export').addEventListener('click', exportCompareMarkdown);
document.getElementById('compare-close').addEventListener('click', closeCompare);

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  const target = e.target;
  const inInput = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);

  // Escape: close any open overlay
  if (e.key === 'Escape') {
    if (!document.getElementById('compare-drawer').hidden) { closeCompare(); return; }
    if (!document.getElementById('library-popup').hidden) { closeLibrary(); return; }
    closeChatPicker();
    return;
  }

  if (!cmd) {
    // Alt+1..9: focus nth pane (no cmd required; less likely to conflict)
    if (e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const id = state.crew[idx];
      if (id) { e.preventDefault(); focusPane(id); }
    }
    return;
  }

  // Cmd+K: focus prompt
  if ((e.key === 'k' || e.key === 'K') && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('prompt').focus();
    return;
  }
  // Cmd+/: toggle library
  if (e.key === '/' && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const popup = document.getElementById('library-popup');
    if (popup.hidden) openLibrary(); else closeLibrary();
    return;
  }
  // Cmd+B: toggle blind mode
  if ((e.key === 'b' || e.key === 'B') && !e.altKey && !e.shiftKey && !inInput) {
    e.preventDefault();
    toggleBlind();
    return;
  }
  // Cmd+Shift+C: open compare
  if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    e.preventDefault();
    const drawer = document.getElementById('compare-drawer');
    if (drawer.hidden) openCompare(); else closeCompare();
    return;
  }
});

let bannerTimer = null;
function showBanner(text, ms = 4500) {
  const el = document.getElementById('banner');
  el.textContent = text;
  el.hidden = false;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
}

loadLibrary().then(loadState);
