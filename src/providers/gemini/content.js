(function () {
  'use strict';
  const R = window.__multaiRuntime;
  if (!R) { console.error('[multai-gemini] runtime missing'); return; }

  const PROVIDER = 'gemini';

  const S = {
    promptInput: [
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="Enter a prompt" i]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[aria-label*="Send message" i]',
      'button[aria-label="Send"]',
      'button[mattooltip*="Send" i]',
      'button.send-button'
    ],
    stopButton: [
      'button[aria-label*="Stop"]'
    ],
    fileInput: [
      'input[type="file"]'
    ],
    dropTarget: [
      'input-area-v2',
      'main',
      'body'
    ],
    newChatLink: [
      'button[aria-label*="New chat" i]',
      'expandable-button[aria-label*="New chat" i] button',
      'a[href="/app"]'
    ],
    lastResponse: [
      'message-content.model-response-text',
      'model-response',
      'div[class*="model-response-text"]',
      'div[class*="model-response"]'
    ]
  };

  async function probe() {
    return {
      ready: !!R.findFirst(S.promptInput),
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
    location.assign('/app');
  }

  R.register({ provider: PROVIDER, probe, broadcast, newChat, lastResponseSelectors: S.lastResponse });
})();
