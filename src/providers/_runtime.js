(function () {
  'use strict';
  if (window.__multaiRuntime) return;

  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;

  function findFirst(list, root) {
    root = root || document;
    for (const sel of list || []) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) { /* invalid selector in one list entry — try the next */ }
    }
    return null;
  }

  function findAll(list, root) {
    root = root || document;
    for (const sel of list || []) {
      try {
        const els = root.querySelectorAll(sel);
        if (els.length) return Array.from(els);
      } catch (_) { /* ignore */ }
    }
    return [];
  }

  function isUsable(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function findFirstVisible(list, root) {
    root = root || document;
    for (const sel of list || []) {
      try {
        const els = root.querySelectorAll(sel);
        for (const el of els) {
          if (isUsable(el)) return el;
        }
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, interval) {
    timeoutMs = timeoutMs || 8000;
    interval = interval || 60;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = fn();
        if (result) return result;
      } catch (_) { /* keep polling */ }
      await wait(interval);
    }
    return null;
  }

  function setTextareaValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function currentText(el) {
    return ((el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim());
  }

  function selectAll(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function typeIntoContentEditable(el, text) {
    try { el.click(); } catch (_) {}
    try { window.focus(); } catch (_) {}
    el.focus();
    selectAll(el);

    // Strategy 1: beforeinput InputEvent — Lexical, Slate, ProseMirror, etc.
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        bubbles: true, cancelable: true, composed: true
      }));
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: text,
        bubbles: true, cancelable: true, composed: true
      }));
    } catch (_) {}
    await wait(80);
    if (currentText(el) === text) return;

    // Strategy 2: execCommand — classic contenteditable.
    selectAll(el);
    try {
      document.execCommand('delete', false);
      document.execCommand('insertText', false, text);
    } catch (_) {}
    await wait(80);
    if (currentText(el) === text) return;

    // Strategy 3: insertFromPaste via InputEvent + DataTransfer — many React
    // rich-text editors handle this path reliably.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      selectAll(el);
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        dataTransfer: dt,
        bubbles: true, cancelable: true, composed: true
      }));
    } catch (_) {}
    await wait(80);
    if (currentText(el) === text) return;

    // Strategy 4: synthetic ClipboardEvent paste.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true, cancelable: true
      }));
    } catch (_) {}
    await wait(80);
    if (currentText(el) === text) return;

    // Strategy 5: composition events (IME-style) — some editors handle
    // insertCompositionText even when they reject insertText.
    try {
      const sel2 = window.getSelection();
      const range2 = document.createRange();
      range2.selectNodeContents(el);
      range2.collapse(false);
      sel2.removeAllRanges();
      sel2.addRange(range2);
      el.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true, cancelable: true, composed: true, data: ''
      }));
      el.dispatchEvent(new CompositionEvent('compositionupdate', {
        bubbles: true, cancelable: true, composed: true, data: text
      }));
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertCompositionText',
        data: text,
        bubbles: true, cancelable: true, composed: true
      }));
      el.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true, cancelable: true, composed: true, data: text
      }));
    } catch (_) {}
    await wait(80);
    if (currentText(el) === text) return;

    // Strategy 6: character-by-character — slow but the closest synthetic
    // equivalent to real typing. Works on editors that insist on per-char
    // beforeinput + input pairs.
    try {
      el.textContent = '';
      for (const char of text) {
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: char,
          bubbles: true, cancelable: true, composed: true
        }));
        el.dispatchEvent(new InputEvent('input', {
          inputType: 'insertText',
          data: char,
          bubbles: true, cancelable: true, composed: true
        }));
        await wait(2);
      }
    } catch (_) {}
    if (currentText(el) === text) return;

    // Strategy 6: brute force.
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: text
    }));
  }

  async function setPrompt(el, text) {
    if (!el) throw new Error('prompt input not found');
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setTextareaValue(el, text);
    } else {
      await typeIntoContentEditable(el, text);
    }
  }

  async function clickWhenEnabled(sendButtonSelectors, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    const btn = await waitFor(() => {
      const b = findFirst(sendButtonSelectors);
      if (!b) return null;
      if (b.disabled) return null;
      if (b.getAttribute('aria-disabled') === 'true') return null;
      return b;
    }, timeoutMs);
    if (!btn) throw new Error('send button never became ready');
    btn.click();
    return btn;
  }

  function pressEnter(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  // Click the send button; if no matching/enabled button, fall back to pressing
  // Enter in the input. Most sites treat Enter as submit for chat composers.
  async function submit(input, sendButtonSelectors, clickTimeoutMs) {
    clickTimeoutMs = clickTimeoutMs == null ? 4000 : clickTimeoutMs;
    try {
      await clickWhenEnabled(sendButtonSelectors, clickTimeoutMs);
    } catch (_) {
      pressEnter(input);
    }
  }

  async function attachFiles(files, fileInputSel, dropTargetSel) {
    if (!files || !files.length) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);

    const input = findFirst(fileInputSel);
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const target = findFirst(dropTargetSel);
    if (!target) throw new Error('no drop target for attachments');
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragenter', opts));
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  }

  async function readLast(selectors) {
    for (const sel of selectors || []) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length) {
          const last = els[els.length - 1];
          return {
            text: (last.innerText || last.textContent || '').trim(),
            html: last.outerHTML || ''
          };
        }
      } catch (_) { /* try next */ }
    }
    return { text: '', html: '' };
  }

  function register(config) {
    const PROVIDER = config.provider;

    window.addEventListener('message', async (e) => {
      if (e.origin !== EXT_ORIGIN) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (typeof data.type !== 'string' || !data.type.startsWith('multai:')) return;

      const reply = (body) => {
        try {
          e.source.postMessage({ ...body, provider: PROVIDER, _replyTo: data._id }, EXT_ORIGIN);
        } catch (_) { /* sender gone */ }
      };

      try {
        switch (data.type) {
          case 'multai:wake':
            try { e.source.postMessage({ type: 'multai:ready', provider: PROVIDER }, EXT_ORIGIN); } catch (_) {}
            break;
          case 'multai:probe':
            reply({ type: 'multai:probe-result', state: await config.probe() });
            break;
          case 'multai:broadcast':
            await config.broadcast(data.payload || {});
            reply({ type: 'multai:broadcast-ack', ok: true });
            break;
          case 'multai:new-chat':
            if (config.newChat) await config.newChat();
            reply({ type: 'multai:new-chat-ack', ok: true });
            break;
          case 'multai:set-chat':
            if (config.setChat) await config.setChat(data.chatId);
            reply({ type: 'multai:set-chat-ack', ok: true });
            break;
          case 'multai:read-last': {
            const r = await readLast(config.lastResponseSelectors || []);
            reply({ type: 'multai:read-last-result', text: r.text, html: r.html });
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

    // Wait for the cockpit to wake us instead of broadcasting spontaneously.
    // Reason: with `all_frames: true`, this script also runs inside nested
    // provider iframes (Cloudflare turnstile, Google auth, etc.) whose parent
    // is the provider page, not the cockpit — and posting there with a
    // chrome-extension:// targetOrigin spews warnings into DevTools.
    console.info(`[multai-${PROVIDER}] content script loaded`);
  }

  // Find a clickable button inside a container whose text mentions the given
  // keywords (e.g. "cookie", "consent"), then click it. Returns true if a
  // matching button was found and clicked.
  async function dismissBanner(keywords, buttonLabels, timeoutMs) {
    timeoutMs = timeoutMs == null ? 5000 : timeoutMs;
    keywords = (keywords || []).map(k => k.toLowerCase());
    buttonLabels = (buttonLabels || []).map(l => l.toLowerCase());

    const btn = await waitFor(() => {
      const candidates = document.querySelectorAll('button, [role="button"], a');
      for (const el of candidates) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (!text) continue;
        if (!buttonLabels.some(l => text === l || text.includes(l))) continue;
        // Require the button to be inside a container whose text mentions one
        // of the keywords — guards against clicking random "Accept" links.
        let p = el;
        for (let i = 0; i < 10 && p; i++) {
          const ptxt = (p.textContent || '').toLowerCase();
          if (keywords.some(k => ptxt.includes(k))) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return el;
          }
          p = p.parentElement;
        }
      }
      return null;
    }, timeoutMs, 400);

    if (btn) {
      try { btn.click(); return true; } catch (_) { return false; }
    }
    return false;
  }

  // Install a banner auto-dismisser that keeps watching until the banner is
  // clicked or the timeout expires. Useful for cookie/consent dialogs that
  // re-render on every iframe load.
  function watchAndDismiss(keywords, buttonLabels, { timeoutMs = 30000 } = {}) {
    let done = false;
    const finish = () => { done = true; observer.disconnect(); };
    const tryOnce = async () => {
      if (done) return;
      const ok = await dismissBanner(keywords, buttonLabels, 800);
      if (ok) finish();
    };
    tryOnce();
    const observer = new MutationObserver(() => { if (!done) tryOnce(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(finish, timeoutMs);
  }

  window.__multaiRuntime = {
    findFirst, findAll, findFirstVisible, isUsable,
    wait, waitFor,
    setTextareaValue, typeIntoContentEditable, setPrompt,
    clickWhenEnabled, pressEnter, submit, attachFiles,
    readLast, dismissBanner, watchAndDismiss, register
  };
})();
