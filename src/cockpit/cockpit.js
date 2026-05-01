import { PROVIDERS, DEFAULT_CREW, getProvider } from '../shared/providers.js';
import { MSG, sendToPane } from '../shared/messaging.js';
import { MAX_ATTACHMENT_BYTES, formatSize, truncateName } from '../shared/attachments.js';

const STATE_KEY = 'multai.state';
const PLANS_KEY = 'multai.plans';
const LIBRARY_KEY = 'multai.library';

const state = {
  crew: [...DEFAULT_CREW],
  paneSettings: {},
  benchCollapsed: false,
  controlsCollapsed: false,
  promptCollapsed: false,
  maxPerRow: 3,
  rowHeights: [],
  layoutMode: 'grid',   // 'grid' | 'tabs'
  activeTab: null       // providerId shown in tabs mode
};

const DEFAULT_ROW_HEIGHT = 720;
const MIN_ROW_HEIGHT = 240;

const panes = {};                 // { [providerId]: { iframe, ready, state } }
let attachments = [];             // File[]
let library = [];                 // [{ id, name, text }]

const PANE_ORIGINS = new Set(PROVIDERS.map(p => p.origin));

/* ---------- Storage ---------- */

async function loadState() {
  const saved = await chrome.storage.local.get(STATE_KEY);
  if (saved[STATE_KEY]) Object.assign(state, saved[STATE_KEY]);
  // Prune any provider ids that no longer exist (e.g. after a provider is removed)
  const valid = new Set(PROVIDERS.map(p => p.id));
  const before = state.crew.length;
  state.crew = state.crew.filter(id => valid.has(id));
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
  renderPerRow();
  renderLayoutMode();
  renderGrid();
  renderBench();
  applyControlsCollapsed();
  applyPromptCollapsed();
}

function renderLayoutMode() {
  const mode = state.layoutMode === 'tabs' ? 'tabs' : 'grid';
  document.body.dataset.layoutMode = mode;
  for (const chip of document.querySelectorAll('.chip[data-layout]')) {
    chip.classList.toggle('is-active', chip.dataset.layout === mode);
  }
  requestAnimationFrame(updateGridOffset);
}

function updateGridOffset() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  if (state.layoutMode !== 'tabs') {
    grid.style.removeProperty('--grid-offset');
    return;
  }
  // Measure space above the grid so the tabs pane fills remaining viewport.
  const top = grid.getBoundingClientRect().top + window.scrollY;
  const bottomPadding = 24;
  grid.style.setProperty('--grid-offset', `${Math.max(0, top + bottomPadding)}px`);
}

window.addEventListener('resize', () => requestAnimationFrame(updateGridOffset));

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

function renderPerRow() {
  const value = state.maxPerRow || 3;
  for (const chip of document.querySelectorAll('.chip[data-per-row]')) {
    chip.classList.toggle('is-active', Number(chip.dataset.perRow) === value);
  }
}

/* ---------- Render grid ---------- *
 * Panes are created at most once per provider and kept alive in the DOM.
 * Hiding a pane (display: none) keeps its iframe and chat state intact,
 * so removing and re-adding a provider never resets the conversation.
 * CSS Grid places visible panes; column count comes from state.maxPerRow.
 */

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.classList.remove('is-dragging');
  const tabsMode = state.layoutMode === 'tabs';
  grid.classList.toggle('is-tabs-mode', tabsMode);

  // Remove placeholder and tab bar from previous render
  grid.querySelectorAll('.pane-placeholder-host').forEach(el => el.remove());
  grid.querySelectorAll('.tab-bar').forEach(el => el.remove());
  grid.querySelectorAll('.row-splitter').forEach(el => el.remove());

  // Drop panes for providers that no longer exist in PROVIDERS at all
  const validIds = new Set(PROVIDERS.map(p => p.id));
  for (const id of Object.keys(panes)) {
    if (!validIds.has(id)) {
      panes[id]?.element?.remove();
      delete panes[id];
    }
  }

  if (state.crew.length === 0) {
    // Hide every pane but keep their iframes alive
    for (const id of Object.keys(panes)) {
      if (panes[id].element) panes[id].element.classList.add('is-hidden');
    }
    const host = document.createElement('div');
    host.className = 'pane-placeholder-host';
    host.innerHTML = `
      <div class="pane-placeholder">
        <strong>No providers active.</strong>
        <span>Click any name in the Crew row above to activate it.</span>
      </div>
    `;
    grid.appendChild(host);
    grid.style.setProperty('--cols', '1');
    grid.style.gridTemplateRows = '';
    return;
  }

  // Ensure a pane exists for each crew member (create once, reuse forever)
  for (const id of state.crew) {
    if (!panes[id]?.element) {
      const provider = getProvider(id);
      if (provider) {
        const pane = createPane(provider);
        attachPaneSwapHandlers(pane, id);
        grid.appendChild(pane);
      }
    }
  }

  if (tabsMode) {
    // Validate active tab, fall back to first crew member
    if (!state.crew.includes(state.activeTab)) {
      state.activeTab = state.crew[0];
    }
    renderTabBar(grid);

    for (const id of Object.keys(panes)) {
      const el = panes[id].element;
      if (!el) continue;
      el.style.order = '';
      el.classList.toggle('is-hidden', id !== state.activeTab);
    }
    grid.style.setProperty('--cols', '1');
    grid.style.gridTemplateRows = '';
    return;
  }

  // Grid mode: show / hide based on crew membership and set grid order
  const maxCols = clamp(state.maxPerRow || 3, 1, 4);
  const cols = Math.min(maxCols, state.crew.length);
  grid.style.setProperty('--cols', String(cols));

  for (const id of Object.keys(panes)) {
    const el = panes[id].element;
    if (!el) continue;
    const idx = state.crew.indexOf(id);
    if (idx === -1) {
      el.classList.add('is-hidden');
      el.style.order = '';
    } else {
      el.classList.remove('is-hidden');
      el.style.order = String(idx);
    }
  }

  syncRowHeights();
  applyGridTemplateRows();
  renderRowSplitters();
}

function renderTabBar(grid) {
  const bar = document.createElement('div');
  bar.className = 'tab-bar';
  for (const id of state.crew) {
    const provider = getProvider(id);
    if (!provider) continue;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab' + (id === state.activeTab ? ' is-active' : '');
    tab.textContent = provider.label;
    tab.title = provider.label;
    tab.addEventListener('click', () => setActiveTab(id));
    bar.appendChild(tab);
  }
  grid.prepend(bar);
}

function setActiveTab(providerId) {
  if (state.activeTab === providerId) return;
  state.activeTab = providerId;
  saveState();
  renderGrid();
}

function setLayoutMode(mode) {
  const next = mode === 'tabs' ? 'tabs' : 'grid';
  if (state.layoutMode === next) return;
  state.layoutMode = next;
  if (next === 'tabs' && !state.crew.includes(state.activeTab)) {
    state.activeTab = state.crew[0] || null;
  }
  saveState();
  renderLayoutMode();
  renderGrid();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ---------- Row resize ---------- */

function syncRowHeights() {
  const maxCols = clamp(state.maxPerRow || 3, 1, 4);
  const cols = Math.min(maxCols, state.crew.length);
  const rows = state.crew.length === 0 ? 0 : Math.max(1, Math.ceil(state.crew.length / Math.max(cols, 1)));
  if (!Array.isArray(state.rowHeights)) state.rowHeights = [];
  while (state.rowHeights.length < rows) state.rowHeights.push(DEFAULT_ROW_HEIGHT);
  if (state.rowHeights.length > rows) state.rowHeights.length = rows;
  return { cols, rows };
}

function applyGridTemplateRows() {
  const grid = document.getElementById('grid');
  const { rows } = syncRowHeights();
  if (rows <= 1) {
    grid.style.gridTemplateRows = '';
  } else {
    grid.style.gridTemplateRows = state.rowHeights.map(h => `${h}px`).join(' ');
  }
}

function renderRowSplitters() {
  const grid = document.getElementById('grid');
  grid.querySelectorAll('.row-splitter').forEach(el => el.remove());
  const { rows } = syncRowHeights();
  if (rows < 2) return;
  for (let i = 0; i < rows - 1; i++) {
    const splitter = document.createElement('div');
    splitter.className = 'row-splitter';
    splitter.dataset.row = String(i);
    splitter.title = 'Drag to resize rows';
    splitter.addEventListener('mousedown', (e) => startRowResizeDrag(e, i));
    grid.appendChild(splitter);
  }
  positionRowSplitters();
}

function positionRowSplitters() {
  const grid = document.getElementById('grid');
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.rowGap) || 12;
  const padTop = parseFloat(cs.paddingTop) || 0;
  const heights = state.rowHeights || [];
  const splitters = grid.querySelectorAll('.row-splitter');
  splitters.forEach((s, i) => {
    let top = padTop;
    for (let j = 0; j <= i; j++) top += heights[j] || DEFAULT_ROW_HEIGHT;
    top += i * gap;
    s.style.top = `${top}px`;
  });
}

function startRowResizeDrag(e, rowIdx) {
  e.preventDefault();
  const grid = document.getElementById('grid');
  const splitter = e.currentTarget;
  grid.classList.add('is-dragging');
  splitter.classList.add('is-active');

  const startY = e.clientY;
  const startA = state.rowHeights[rowIdx];

  function onMove(ev) {
    const delta = ev.clientY - startY;
    const newH = Math.max(MIN_ROW_HEIGHT, startA + delta);
    for (let i = 0; i < state.rowHeights.length; i++) {
      state.rowHeights[i] = newH;
    }
    applyGridTemplateRows();
    positionRowSplitters();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    grid.classList.remove('is-dragging');
    splitter.classList.remove('is-active');
    saveState();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ---------- Pane swap via drag ---------- */

function attachPaneSwapHandlers(pane, providerId) {
  const title = pane.querySelector('.pane-title');
  if (title) {
    title.setAttribute('draggable', 'true');
    title.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-multai-pane', providerId);
      e.dataTransfer.effectAllowed = 'move';
      pane.classList.add('is-pane-dragging');
      document.getElementById('grid').classList.add('is-dragging');
    });
    title.addEventListener('dragend', () => {
      pane.classList.remove('is-pane-dragging');
      document.getElementById('grid').classList.remove('is-dragging');
      document.querySelectorAll('.pane.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    });
  }

  pane.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-multai-pane')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!pane.classList.contains('is-pane-dragging')) {
      pane.classList.add('is-drop-target');
    }
  });
  pane.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && pane.contains(e.relatedTarget)) return;
    pane.classList.remove('is-drop-target');
  });
  pane.addEventListener('drop', (e) => {
    const srcId = e.dataTransfer.getData('application/x-multai-pane');
    pane.classList.remove('is-drop-target');
    if (!srcId || srcId === providerId) return;
    e.preventDefault();
    const srcIdx = state.crew.indexOf(srcId);
    const dstIdx = state.crew.indexOf(providerId);
    if (srcIdx === -1 || dstIdx === -1) return;
    const next = state.crew.slice();
    [next[srcIdx], next[dstIdx]] = [next[dstIdx], next[srcIdx]];
    state.crew = next;
    saveState();
    renderGrid();
  });
}

function createPane(provider) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.dataset.provider = provider.id;

  pane.innerHTML = `
    <div class="pane-header">
      <div class="pane-title-row">
        <span class="pane-title">${escapeHtml(provider.label)}</span>
        <div class="pane-actions">
          <span class="pane-status" data-role="status">loading</span>
          <button type="button" class="pane-action" data-pane-action="judge" title="Ask this model to judge other models' responses">Judge</button>
          <button type="button" class="pane-action" data-pane-action="quote" title="Quote current selection from this pane">Quote</button>
          <button type="button" class="pane-action" data-pane-action="open-site" title="Open this chat in a new tab">Open</button>
          <button type="button" class="pane-action" data-pane-action="reload">Reload</button>
          <button type="button" class="pane-action" data-pane-action="focus">Focus</button>
          <button type="button" class="pane-action" data-pane-action="new-chat">New chat</button>
        </div>
      </div>
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

  pane.querySelector('[data-pane-action="judge"]').addEventListener('click', () => judgePane(provider.id));
  pane.querySelector('[data-pane-action="quote"]').addEventListener('click', () => quoteFromPane(provider.id));
  pane.querySelector('[data-pane-action="open-site"]').addEventListener('click', () => openPaneInTab(provider.id));
  pane.querySelector('[data-pane-action="reload"]').addEventListener('click', () => reloadPane(provider.id));
  pane.querySelector('[data-pane-action="focus"]').addEventListener('click', () => focusPane(provider.id));
  pane.querySelector('[data-pane-action="new-chat"]').addEventListener('click', () => newChatOn(provider.id));
  pane.querySelector('[data-pane-action="open-tab"]').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'multai:open-in-tab', url: provider.url });
  });
  pane.querySelector('[data-pane-action="retry"]').addEventListener('click', () => reloadPane(provider.id));

  const iframe = pane.querySelector('iframe');
  const fallback = pane.querySelector('[data-role="fallback"]');
  panes[provider.id] = { iframe, fallback, ready: false, state: null, element: pane };

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

function updatePaneHeader(providerId) {
  const pane = panes[providerId];
  const paneEl = document.querySelector(`.pane[data-provider="${providerId}"]`);
  if (!pane || !paneEl) return;

  const statusEl = paneEl.querySelector('[data-role="status"]');
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
}

function renderBench() {
  const el = document.getElementById('bench');
  el.innerHTML = '';
  const bench = PROVIDERS.filter(p => !state.crew.includes(p.id));
  if (bench.length === 0) {
    el.classList.remove('is-collapsed');
    document.body.dataset.benchState = 'empty';
    return;
  }

  const collapsed = !!state.benchCollapsed;
  el.classList.toggle('is-collapsed', collapsed);
  document.body.dataset.benchState = collapsed ? 'collapsed' : 'expanded';

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

function toggleControls() {
  state.controlsCollapsed = !state.controlsCollapsed;
  saveState();
  applyControlsCollapsed();
}

function applyControlsCollapsed() {
  const controls = document.getElementById('controls');
  if (controls) controls.classList.toggle('is-collapsed', !!state.controlsCollapsed);
  const btn = document.getElementById('controls-toggle');
  requestAnimationFrame(updateGridOffset);
  if (btn) {
    const collapsed = !!state.controlsCollapsed;
    btn.textContent = collapsed ? '▼' : '▲';
    const label = collapsed ? 'Expand controls' : 'Collapse controls';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function togglePrompt() {
  state.promptCollapsed = !state.promptCollapsed;
  saveState();
  applyPromptCollapsed();
}

function applyPromptCollapsed() {
  const area = document.getElementById('prompt-area');
  if (area) area.classList.toggle('is-collapsed', !!state.promptCollapsed);
  const btn = document.getElementById('prompt-toggle');
  requestAnimationFrame(updateGridOffset);
  if (btn) {
    const collapsed = !!state.promptCollapsed;
    btn.textContent = collapsed ? '▼' : '▲';
    const label = collapsed ? 'Expand prompt' : 'Collapse prompt';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function setMaxPerRow(value) {
  const n = clamp(Number(value) || 3, 1, 4);
  if (state.maxPerRow === n) return;
  state.maxPerRow = n;
  saveState();
  renderPerRow();
  renderGrid();
}

async function newConversationAll() {
  const crew = state.crew.slice();
  if (crew.length === 0) {
    showBanner('No active panes — activate a provider first.');
    return;
  }
  await Promise.allSettled(crew.map(id => newChatOn(id)));
  showBanner(`Started a new conversation in ${crew.length} pane${crew.length === 1 ? '' : 's'}.`);
}

async function getPaneCurrentUrl(providerId) {
  const pane = panes[providerId];
  const provider = getProvider(providerId);
  if (!pane?.ready || !pane.iframe?.contentWindow || !provider?.hasContentScript) {
    return pane?.iframe?.src || '';
  }
  try {
    const res = await sendToPane(pane.iframe, provider.origin, { type: MSG.GET_URL }, { timeoutMs: 2000 });
    return res.url || pane.iframe.src || '';
  } catch (_) {
    return pane.iframe.src || '';
  }
}

async function reloadPaneTo(providerId, url) {
  const p = panes[providerId];
  if (!p) return;
  const currentUrl = await getPaneCurrentUrl(providerId);

  // Hash-only temporary chat toggles (Grok/Gemini) may not trigger a load
  // event, and reloading can preserve the page's current non-temporary route.
  // Navigate the iframe window directly so the site sees the target URL.
  if (currentUrl && currentUrl.split('#')[0] === url.split('#')[0]) {
    p.ready = false;
    p.state = null;
    if (p.fallback) p.fallback.hidden = true;
    if (p.iframe) p.iframe.style.opacity = '';
    updatePaneHeader(providerId);
    if (getProvider(providerId)?.hasContentScript) startReadyWatchdog(providerId);
    try {
      p.iframe.contentWindow.location.replace(url);
    } catch (_) {
      p.iframe.src = url;
    }
    setTimeout(() => wakePane(providerId), 250);
    return;
  }

  reloadPane(providerId, url);
}

async function newTemporaryChatAll() {
  const crew = state.crew.slice();
  if (crew.length === 0) {
    showBanner('No active panes — activate a provider first.');
    return;
  }
  const supported = [];
  const unsupported = [];
  const tasks = [];
  for (const id of crew) {
    const provider = getProvider(id);
    if (!provider) continue;
    if (provider.temporaryUrl) {
      tasks.push(reloadPaneTo(id, provider.temporaryUrl));
      supported.push(provider.label);
    } else {
      unsupported.push(provider.label);
    }
  }
  if (tasks.length) await Promise.allSettled(tasks);
  const parts = [];
  if (supported.length) parts.push(`Temporary chat: ${supported.join(', ')}`);
  if (unsupported.length) parts.push(`Not supported: ${unsupported.join(', ')}`);
  if (parts.length) showBanner(parts.join(' · '));
}

function reloadPane(providerId, newUrl) {
  const p = panes[providerId];
  if (!p) return;
  p.ready = false;
  p.state = null;
  if (p.fallback) p.fallback.hidden = true;
  if (p.iframe) p.iframe.style.opacity = '';
  updatePaneHeader(providerId);
  p.iframe.addEventListener('load', () => wakePane(providerId), { once: true });
  if (newUrl) p.iframe.src = newUrl;
  else p.iframe.src = p.iframe.src;
  const provider = getProvider(providerId);
  if (provider?.hasContentScript) startReadyWatchdog(providerId);
}

function focusPane(providerId) {
  state.crew = [providerId];
  saveState();
  render();
}

async function openPaneInTab(providerId) {
  const pane = panes[providerId];
  const provider = getProvider(providerId);
  if (!provider) return;
  let url = provider.url;
  if (pane?.ready && pane.iframe?.contentWindow) {
    try {
      const res = await sendToPane(pane.iframe, provider.origin, { type: MSG.GET_URL }, { timeoutMs: 2000 });
      if (res.url) url = res.url;
    } catch (_) { /* fall back to provider.url */ }
  }
  chrome.runtime.sendMessage({ type: 'multai:open-in-tab', url });
}

async function newChatOn(providerId) {
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
    const label = provider.label;
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
    const label = provider.label;
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

/* ---------- Judge ---------- */

let isJudging = false;
let pendingJudgeProviderId = null;

function judgePane(providerId) {
  if (isJudging || isBroadcasting) return;
  const provider = getProvider(providerId);
  const targetPane = panes[providerId];
  if (!provider || !targetPane?.ready) {
    showBanner(`${provider?.label || 'Pane'} isn't ready yet.`);
    return;
  }

  const others = state.crew.filter(id => id !== providerId && panes[id]?.ready && getProvider(id));
  if (others.length === 0) {
    showBanner('Need at least one other ready pane to judge.');
    return;
  }

  pendingJudgeProviderId = providerId;
  const list = document.getElementById('judge-picker-list');
  list.innerHTML = others.map(id => {
    const p = getProvider(id);
    return `<li>
      <label class="judge-picker-item">
        <input type="checkbox" value="${id}" checked>
        <span>${escapeHtml(p.label)}</span>
      </label>
    </li>`;
  }).join('');
  document.getElementById('judge-picker').hidden = false;
}

function closeJudgePicker() {
  document.getElementById('judge-picker').hidden = true;
  pendingJudgeProviderId = null;
}

function toggleAllJudgePicker() {
  const boxes = document.querySelectorAll('#judge-picker-list input[type="checkbox"]');
  const allChecked = Array.from(boxes).every(cb => cb.checked);
  boxes.forEach(cb => { cb.checked = !allChecked; });
}

async function confirmJudge() {
  const providerId = pendingJudgeProviderId;
  if (!providerId) return;
  const selected = Array.from(document.querySelectorAll('#judge-picker-list input[type="checkbox"]:checked'))
    .map(cb => cb.value);

  closeJudgePicker();

  if (selected.length === 0) {
    showBanner('Select at least one model to judge.');
    return;
  }

  const provider = getProvider(providerId);
  const targetPane = panes[providerId];
  if (!provider || !targetPane?.ready) return;

  isJudging = true;
  const judgeBtn = document.querySelector(`.pane[data-provider="${providerId}"] [data-pane-action="judge"]`);
  if (judgeBtn) { judgeBtn.textContent = 'Judging…'; judgeBtn.disabled = true; }

  const results = await Promise.allSettled(
    selected.map(async id => {
      const p = getProvider(id);
      const pane = panes[id];
      const res = await sendToPane(pane.iframe, p.origin, { type: MSG.READ_LAST }, { timeoutMs: 6000 });
      return { id, label: p.label, text: (res.text || '').trim() };
    })
  );

  const responses = results
    .filter(r => r.status === 'fulfilled' && r.value.text)
    .map(r => r.value);

  if (responses.length === 0) {
    showBanner('Could not read any responses from the selected panes.');
    isJudging = false;
    if (judgeBtn) { judgeBtn.textContent = 'Judge'; judgeBtn.disabled = false; }
    return;
  }

  const sections = responses.map(r => `--- ${r.label} ---\n${r.text}`).join('\n\n');
  const prompt =
    'Given the following responses from different AI models, analyze them and determine ' +
    'which response is the most correct and comprehensive. Explain your reasoning.\n\n' +
    sections +
    '\n\nBased on the above, what do you think is the most correct response? Please provide your analysis.';

  try {
    targetPane.iframe.focus();
    await sendToPane(targetPane.iframe, provider.origin, {
      type: MSG.BROADCAST,
      payload: { prompt, files: [], skipSubmit: true }
    }, { timeoutMs: 120000 });
    showBanner(`${provider.label} has the judge prompt loaded — review and send when ready.`);
  } catch (err) {
    showBanner(`Judge failed for ${provider.label}: ${err.message || err}`);
  }

  isJudging = false;
  if (judgeBtn) { judgeBtn.textContent = 'Judge'; judgeBtn.disabled = false; }
  probePane(providerId);
}

document.getElementById('judge-picker-close').addEventListener('click', closeJudgePicker);
document.getElementById('judge-picker-toggle-all').addEventListener('click', toggleAllJudgePicker);
document.getElementById('judge-picker-confirm').addEventListener('click', confirmJudge);

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

document.querySelector('[data-action="open-settings"]').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

for (const chip of document.querySelectorAll('.chip[data-per-row]')) {
  chip.addEventListener('click', () => setMaxPerRow(chip.dataset.perRow));
}

for (const chip of document.querySelectorAll('.chip[data-layout]')) {
  chip.addEventListener('click', () => setLayoutMode(chip.dataset.layout));
}

document.querySelector('[data-action="compare"]')?.addEventListener('click', openCompare);
document.querySelector('[data-action="new-conversation"]')?.addEventListener('click', newConversationAll);
document.querySelector('[data-action="new-temporary-chat"]')?.addEventListener('click', newTemporaryChatAll);
document.getElementById('controls-toggle')?.addEventListener('click', toggleControls);
document.getElementById('prompt-toggle')?.addEventListener('click', togglePrompt);

document.getElementById('library-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const popup = document.getElementById('library-popup');
  if (popup.hidden) openLibrary(); else closeLibrary();
});
document.getElementById('library-save').addEventListener('click', saveCurrentPromptToLibrary);
document.getElementById('library-close').addEventListener('click', closeLibrary);


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
