// Runs in MAIN world at document_start on every provider domain.
// Goal: silence runtime anti-iframe checks (framebusters) so sites that
// refuse to render inside <iframe> via JS (not just headers) still load.
// Strictly read-only — no behavioural changes to the page beyond top/parent.

(function () {
  'use strict';

  try {
    Object.defineProperty(window, 'top', {
      get: function () { return window.self; },
      configurable: true
    });
  } catch (_) { /* already non-configurable */ }

  try {
    Object.defineProperty(window, 'parent', {
      get: function () { return window.self; },
      configurable: true
    });
  } catch (_) { /* already non-configurable */ }

  // Some framebusters compare frameElement to null to detect iframing.
  try {
    Object.defineProperty(window, 'frameElement', {
      get: function () { return null; },
      configurable: true
    });
  } catch (_) { /* already non-configurable */ }
})();
