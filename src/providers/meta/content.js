(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-meta] runtime missing'); return; }

  const PROVIDER = 'meta';

  const S = {
    promptInput: [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="message" i]',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendButton: [
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
    lastResponse: [
      'div[class*="message"][class*="assistant"]',
      'div[class*="bot-message"]',
      'div[class*="ai-message"]',
      'div[class*="markdown"]'
    ]
  };

  async function probe() {
    return {
      ready: !!R.findFirst(S.promptInput),
      currentModel: null,
      availableModels: [],
      plan: 'Free',
      threads: [],
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
