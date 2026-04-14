(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-grok] runtime missing'); return; }

  const PROVIDER = 'grok';

  const S = {
    promptInput: [
      'textarea[aria-label*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="What" i]',
      'textarea[placeholder*="you" i]',
      'form textarea',
      'main textarea',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[type="submit"]',
      'button[aria-label*="Send" i]',
      'div[role="button"][aria-label*="Send" i]',
      'form button:last-of-type',
      'form [role="button"]:last-of-type'
    ],
    stopButton: [
      'button[aria-label*="Stop" i]'
    ],
    fileInput: [
      'input[type="file"]'
    ],
    dropTarget: [
      'form',
      'main',
      'body'
    ],
    modelPickerButton: [
      'button[aria-haspopup="menu"][aria-label*="model" i]',
      'button[aria-haspopup="menu"]'
    ],
    modelMenuItems: [
      '[role="menuitem"]'
    ],
    newChatLink: [
      'a[href="/"][aria-label*="New" i]',
      'button[aria-label*="New chat" i]',
      'a[href="/"]'
    ],
    threadLinks: [
      'a[href^="/chat/"]',
      'a[href^="/c/"]'
    ],
    lastResponse: [
      'div.response-content-markdown',
      'div[class*="response-content-markdown"]',
      'article div[class*="markdown"]'
    ]
  };

  function inferPlan(models) {
    const joined = models.join(' ').toLowerCase();
    if (joined.includes('expert')) return 'SuperGrok';
    if (joined.includes('grok 4') || joined.includes('grok-4')) return 'Premium';
    return 'Free';
  }

  async function readModels() {
    const button = R.findFirst(S.modelPickerButton);
    if (!button) return { current: null, available: [] };
    const current = (button.textContent || '').trim();
    return { current, available: [current] };
  }

  async function readThreads() {
    const links = R.findAll(S.threadLinks);
    const seen = new Set();
    const threads = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(c|chat)\/([\w-]+)/);
      if (!m) continue;
      const id = m[2];
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
    location.assign('/');
  }

  R.register({ provider: PROVIDER, probe, broadcast, newChat, lastResponseSelectors: S.lastResponse });
})();
