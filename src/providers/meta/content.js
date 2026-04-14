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
      '[data-testid*="assistant"]',
      '[data-testid*="message"]',
      '[role="article"]',
      'main [dir="auto"]',
      'div[class*="message"][class*="assistant"]',
      'div[class*="bot-message"]',
      'div[class*="ai-message"]',
      'div[class*="markdown"]'
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

  // Fallback readLast: Meta's chat UI uses obfuscated class names that shift
  // between builds, so start with the selector list but drop to a heuristic
  // pass when nothing matches — walk <main> for the last substantial text
  // block that is not the composer itself.
  async function readLast() {
    const byCss = await R.readLast(S.lastResponse);
    if (byCss.text && byCss.text.length > 0) return byCss;

    const root = document.querySelector('main') || document.body;
    const composer = R.findFirst(S.promptInput);
    const candidates = root.querySelectorAll('div, p, article, section');
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      if (composer && (el === composer || el.contains(composer) || composer.contains(el))) continue;
      const text = (el.innerText || '').trim();
      if (text.length < 40) continue;
      // Prefer leaf-ish containers that are mostly text, not wrappers of
      // many nested divs. `orderFromTop` nudges us toward later (more
      // recent) messages when scores tie.
      const childBlocks = el.querySelectorAll('div, article, section').length;
      const rect = el.getBoundingClientRect();
      const orderFromTop = rect.top || 0;
      const score = text.length / (1 + childBlocks) + orderFromTop * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return { text: '', html: '' };
    return {
      text: (best.innerText || best.textContent || '').trim(),
      html: best.outerHTML || ''
    };
  }

  R.register({ provider: PROVIDER, probe, broadcast, newChat, readLast, lastResponseSelectors: S.lastResponse });
})();
