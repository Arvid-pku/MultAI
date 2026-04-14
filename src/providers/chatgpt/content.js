(function () {
  'use strict';

  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const PROVIDER = 'chatgpt';

  // ---- Selectors (keep at the top for easy patching when the site changes) ----

  const S = {
    promptInput: [
      '#prompt-textarea[contenteditable="true"]',
      'div#prompt-textarea',
      'textarea#prompt-textarea',
      'div[contenteditable="true"].ProseMirror'
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
      'form button[type="submit"]'
    ],
    stopButton: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]'
    ],
    fileInput: [
      'input[type="file"][multiple]',
      'input[type="file"]'
    ],
    dropTarget: [
      'form',
      'main',
      'body'
    ],
    modelPickerButton: [
      'button[data-testid="model-switcher-dropdown-button"]',
      'button[aria-haspopup="menu"][aria-label*="Model"]',
      'button[aria-haspopup="menu"][aria-label*="model"]'
    ],
    modelMenuItems: [
      '[role="menu"] [role="menuitem"]',
      '[role="menuitem"]'
    ],
    newChatLink: [
      'a[data-testid="create-new-chat-button"]',
      'a[aria-label="New chat"]',
      'a[href="/"]'
    ],
    threadLinks: [
      'nav a[href^="/c/"]',
      'a[href^="/c/"]'
    ],
    lastResponse: [
      'div[data-message-author-role="assistant"]',
      'article[data-testid*="conversation-turn"]'
    ]
  };

  function findFirst(list, root = document) {
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findAll(list, root = document) {
    for (const sel of list) {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs = 8000, interval = 60) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = fn();
        if (result) return result;
      } catch (_) { /* ignore */ }
      await wait(interval);
    }
    return null;
  }

  // ---- Core actions ----

  function setTextareaValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeIntoContentEditable(el, text) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    // Fallback if execCommand did not populate the editor
    if ((el.innerText || el.textContent || '').trim() === '') {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  async function setPrompt(text) {
    const input = await waitFor(() => findFirst(S.promptInput), 10000);
    if (!input) throw new Error('prompt input not found');
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      setTextareaValue(input, text);
    } else {
      typeIntoContentEditable(input, text);
    }
    return input;
  }

  async function clickSend() {
    const btn = await waitFor(() => {
      const b = findFirst(S.sendButton);
      if (!b) return null;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return null;
      return b;
    }, 15000);
    if (!btn) throw new Error('send button never became ready');
    btn.click();
  }

  async function attachFiles(files) {
    if (!files?.length) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);

    const input = findFirst(S.fileInput);
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const target = findFirst(S.dropTarget);
    if (!target) throw new Error('no drop target for attachments');
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragenter', opts));
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  }

  async function newChat() {
    const link = findFirst(S.newChatLink);
    if (link && link.tagName === 'A') {
      link.click();
      return;
    }
    if (link) { link.click(); return; }
    location.assign('/');
  }

  async function readThreads() {
    const links = findAll(S.threadLinks);
    const seen = new Set();
    const threads = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/^\/c\/([\w-]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      threads.push({
        id,
        title: (a.textContent || '').trim().slice(0, 80) || 'Untitled',
        href
      });
      if (threads.length >= 40) break;
    }
    return threads;
  }

  async function setChat(chatId) {
    if (!chatId || chatId === 'new') {
      await newChat();
      return;
    }
    const link = document.querySelector(`a[href="/c/${chatId}"]`);
    if (link) { link.click(); return; }
    location.assign(`/c/${chatId}`);
  }

  async function readModels() {
    const button = findFirst(S.modelPickerButton);
    if (!button) return { current: null, available: [] };
    const current = (button.textContent || '').trim();
    button.click();
    await waitFor(() => findAll(S.modelMenuItems).length > 0, 2000);
    const items = findAll(S.modelMenuItems);
    const available = items
      .map(el => (el.textContent || '').trim().split('\n')[0].trim())
      .filter(Boolean);
    // Close the menu
    document.body.click();
    await wait(100);
    return { current, available };
  }

  function inferPlan(models) {
    const joined = models.join(' | ').toLowerCase();
    if (joined.includes('gpt-5 pro') || joined.includes('o3 pro')) return 'Pro';
    if (joined.includes('gpt-5') || joined.includes('o3') || joined.includes('gpt-4o') || joined.includes('o1')) return 'Plus';
    if (models.length <= 2) return 'Free';
    return 'Unknown';
  }

  async function probe() {
    let models = { current: null, available: [] };
    try { models = await readModels(); } catch (_) { /* menu may be modal right now */ }
    const threads = await readThreads().catch(() => []);
    return {
      ready: !!findFirst(S.promptInput),
      currentModel: models.current,
      availableModels: models.available,
      plan: inferPlan(models.available),
      threads,
      generating: !!findFirst(S.stopButton)
    };
  }

  async function broadcast({ prompt, files }) {
    await waitFor(() => findFirst(S.promptInput), 15000);
    if (files?.length) {
      await attachFiles(files);
      // Wait for the send button to settle; uploads re-enable it when done
      await waitFor(() => {
        const b = findFirst(S.sendButton);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
      }, 60000);
    }
    await setPrompt(prompt);
    await wait(80);
    await clickSend();
  }

  // ---- Message protocol ----

  window.addEventListener('message', async (e) => {
    if (e.origin !== EXT_ORIGIN) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.type !== 'string' || !data.type.startsWith('multai:')) return;

    const reply = (body) => {
      try { e.source.postMessage({ ...body, provider: PROVIDER, _replyTo: data._id }, EXT_ORIGIN); }
      catch (_) { /* sender gone */ }
    };

    try {
      switch (data.type) {
        case 'multai:wake':
          try { e.source.postMessage({ type: 'multai:ready', provider: PROVIDER }, EXT_ORIGIN); } catch (_) {}
          break;
        case 'multai:probe':
          reply({ type: 'multai:probe-result', state: await probe() });
          break;
        case 'multai:broadcast':
          await broadcast(data.payload || {});
          reply({ type: 'multai:broadcast-ack', ok: true });
          break;
        case 'multai:new-chat':
          await newChat();
          reply({ type: 'multai:new-chat-ack', ok: true });
          break;
        case 'multai:set-chat':
          await setChat(data.chatId);
          reply({ type: 'multai:set-chat-ack', ok: true });
          break;
        case 'multai:read-last': {
          for (const sel of S.lastResponse) {
            const els = document.querySelectorAll(sel);
            if (els.length) {
              const last = els[els.length - 1];
              reply({
                type: 'multai:read-last-result',
                text: (last.innerText || last.textContent || '').trim(),
                html: last.outerHTML || ''
              });
              return;
            }
          }
          reply({ type: 'multai:read-last-result', text: '', html: '' });
          break;
        }
        case 'multai:read-selection': {
          const t = (window.getSelection && window.getSelection().toString()) || '';
          reply({ type: 'multai:read-selection-result', text: t });
          break;
        }
        default:
          reply({ type: 'multai:error', error: `unknown message: ${data.type}` });
      }
    } catch (err) {
      reply({ type: 'multai:error', error: String(err?.message || err) });
    }
  });

  console.info('[multai-chatgpt] content script loaded');
})();
