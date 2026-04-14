(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-qwen] runtime missing'); return; }

  const PROVIDER = 'qwen';

  const S = {
    promptInput: [
      'textarea#chat-input',
      'textarea[placeholder*="Send" i]',
      'textarea[placeholder*="message" i]',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendButton: [
      'button#send-message-button',
      'button[aria-label*="Send" i]',
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
      'a[href^="/c/"]'
    ],
    lastResponse: [
      'div.markdown-body',
      'div[class*="markdown-body"]',
      'div[class*="markdown"]'
    ]
  };

  async function readThreads() {
    const links = R.findAll(S.threadLinks);
    const seen = new Set();
    const threads = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/c\/([\w-]+)/);
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
})();
