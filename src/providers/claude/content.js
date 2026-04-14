(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-claude] runtime missing'); return; }

  const PROVIDER = 'claude';

  const S = {
    promptInput: [
      'div[contenteditable="true"].ProseMirror',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send"]',
      'fieldset button[type="submit"]',
      'form button[type="submit"]'
    ],
    stopButton: [
      'button[aria-label*="Stop"]'
    ],
    fileInput: [
      'input[type="file"]'
    ],
    dropTarget: [
      'fieldset',
      'form',
      'main'
    ],
    modelPickerButton: [
      'button[data-testid*="model"]',
      'button[aria-label*="model" i]',
      'button[aria-haspopup="menu"]'
    ],
    modelMenuItems: [
      '[role="menu"] [role="menuitem"]',
      '[role="menuitem"]'
    ],
    newChatLink: [
      'a[href="/new"]',
      'a[aria-label*="New chat" i]'
    ],
    threadLinks: [
      'a[href^="/chat/"]'
    ],
    lastResponse: [
      'div.font-claude-message',
      'div[class*="font-claude-message"]',
      'div[data-test-render-count]'
    ]
  };

  function inferPlan(models) {
    const joined = models.join(' ').toLowerCase();
    if (joined.includes('max')) return 'Max';
    if (joined.includes('opus')) return 'Pro';
    if (models.length <= 1) return 'Free';
    return 'Unknown';
  }

  async function readModels() {
    const button = R.findFirst(S.modelPickerButton);
    if (!button) return { current: null, available: [] };
    const current = (button.textContent || '').trim();
    button.click();
    await R.waitFor(() => R.findAll(S.modelMenuItems).length > 0, 1500);
    const items = R.findAll(S.modelMenuItems);
    const available = items.map(el => (el.textContent || '').trim().split('\n')[0].trim()).filter(Boolean);
    document.body.click();
    await R.wait(80);
    return { current, available };
  }

  async function readThreads() {
    const links = R.findAll(S.threadLinks);
    const seen = new Set();
    const threads = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/chat\/([\w-]+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      threads.push({ id, title: (a.textContent || '').trim().slice(0, 80) || 'Untitled', href });
      if (threads.length >= 40) break;
    }
    return threads;
  }

  async function probe() {
    let models = { current: null, available: [] };
    try { models = await readModels(); } catch (_) {}
    const threads = await readThreads().catch(() => []);
    return {
      ready: !!R.findFirst(S.promptInput),
      currentModel: models.current,
      availableModels: models.available,
      plan: inferPlan(models.available),
      threads,
      generating: !!R.findFirst(S.stopButton)
    };
  }

  async function broadcast({ prompt, files }) {
    const input = await R.waitFor(() => R.findFirstVisible(S.promptInput), 15000);
    if (!input) throw new Error('prompt input not found');
    if (files?.length) {
      await R.attachFiles(files, S.fileInput, S.dropTarget);
      await R.waitFor(() => {
        const b = R.findFirst(S.sendButton);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
      }, 60000);
    }
    await R.setPrompt(input, prompt);
    await R.wait(80);
    await R.submit(input, S.sendButton);
  }

  async function newChat() {
    const link = R.findFirst(S.newChatLink);
    if (link) { link.click(); return; }
    location.assign('/new');
  }

  async function setChat(chatId) {
    if (!chatId || chatId === 'new') { await newChat(); return; }
    const link = document.querySelector(`a[href="/chat/${chatId}"]`);
    if (link) { link.click(); return; }
    location.assign(`/chat/${chatId}`);
  }

  R.register({ provider: PROVIDER, probe, broadcast, newChat, setChat, lastResponseSelectors: S.lastResponse });
})();
