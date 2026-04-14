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
