(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-deepseek] runtime missing'); return; }

  const PROVIDER = 'deepseek';

  const S = {
    promptInput: [
      'textarea#chat-input',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="Send" i]',
      'textarea'
    ],
    sendButton: [
      'div[role="button"][aria-label*="Send" i]',
      'button[aria-label*="Send" i]',
      'form button[type="submit"]',
      'button[type="submit"]'
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
    newChatLink: [
      'a[href="/"]',
      'button[aria-label*="New" i]'
    ],
    threadLinks: [
      'a[href^="/a/chat/"]',
      'a[href^="/chat/"]'
    ],
    lastResponse: [
      'div.ds-markdown',
      'div[class*="ds-markdown"]',
      'div[class*="markdown"]'
    ]
  };

  async function readThreads() {
    const links = R.findAll(S.threadLinks);
    const seen = new Set();
    const threads = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(a\/chat|chat)\/([\w-]+)/);
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
    const threads = await readThreads().catch(() => []);
    return {
      ready: !!R.findFirst(S.promptInput),
      currentModel: null,
      availableModels: [],
      plan: 'Free',
      threads,
      generating: !!R.findFirst(S.stopButton)
    };
  }

  async function broadcast({ prompt, files }) {
    const input = await R.waitFor(() => R.findFirstVisible(S.promptInput), 15000);
    if (!input) throw new Error('prompt input not found');
    if (files?.length) {
      await R.attachFiles(files, S.fileInput, S.dropTarget);
      await R.wait(600);
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

  // Auto-dismiss the cookie consent banner. DeepSeek's iframe context has its
  // own partitioned cookies, so the banner reappears every time the pane loads
  // until we accept from within the iframe.
  R.watchAndDismiss(
    ['cookie', 'consent', 'privacy'],
    ['accept all', 'accept cookies', 'accept', 'agree', 'allow all', 'got it', 'ok', 'i understand'],
    { timeoutMs: 20000 }
  );
})();
