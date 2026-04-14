import { PROVIDERS, DEFAULT_CREW } from '../shared/providers.js';

const STATE_KEY = 'multai.state';
const PLANS_KEY = 'multai.plans';

async function loadState() {
  const saved = await chrome.storage.local.get(STATE_KEY);
  return saved[STATE_KEY] || { crew: [...DEFAULT_CREW] };
}

async function loadPlans() {
  const saved = await chrome.storage.local.get(PLANS_KEY);
  return saved[PLANS_KEY] || {};
}

async function renderPlans() {
  const plans = await loadPlans();
  const el = document.getElementById('plans');
  el.innerHTML = '';
  for (const provider of PROVIDERS) {
    const row = document.createElement('div');
    row.className = 'plan-row';
    row.innerHTML = `
      <span class="provider-name">${provider.label}</span>
      <span class="plan-value">${plans[provider.id] || 'not detected'}</span>
    `;
    el.appendChild(row);
  }
}

async function renderCrew() {
  const state = await loadState();
  const el = document.getElementById('crew-config');
  el.innerHTML = '';
  for (const provider of PROVIDERS) {
    const row = document.createElement('div');
    row.className = 'crew-config-row';
    const on = state.crew.includes(provider.id);
    row.innerHTML = `
      <span class="provider-name">${provider.label}</span>
      <button type="button" class="toggle ${on ? 'is-on' : ''}" aria-pressed="${on}" aria-label="Toggle ${provider.label}"></button>
    `;
    row.querySelector('.toggle').addEventListener('click', async () => {
      const s = await loadState();
      s.crew = on ? s.crew.filter(id => id !== provider.id) : [...(s.crew || []), provider.id];
      await chrome.storage.local.set({ [STATE_KEY]: s });
      renderCrew();
    });
    el.appendChild(row);
  }
}

document.getElementById('reset-crew').addEventListener('click', async () => {
  const state = await loadState();
  state.crew = [...DEFAULT_CREW];
  await chrome.storage.local.set({ [STATE_KEY]: state });
  renderCrew();
});

document.getElementById('clear-data').addEventListener('click', async () => {
  const ok = confirm('Clear all multai settings and detected plans?\n\n(Your chats on each provider website are untouched.)');
  if (!ok) return;
  await chrome.storage.local.clear();
  renderPlans();
  renderCrew();
});

renderPlans();
renderCrew();
