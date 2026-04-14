export const MSG = {
  READY: 'multai:ready',
  WAKE: 'multai:wake',
  PROBE: 'multai:probe',
  PROBE_RESULT: 'multai:probe-result',
  BROADCAST: 'multai:broadcast',
  BROADCAST_ACK: 'multai:broadcast-ack',
  NEW_CHAT: 'multai:new-chat',
  NEW_CHAT_ACK: 'multai:new-chat-ack',
  SET_CHAT: 'multai:set-chat',
  SET_CHAT_ACK: 'multai:set-chat-ack',
  SET_SETTINGS: 'multai:set-settings',
  SET_SETTINGS_ACK: 'multai:set-settings-ack',
  READ_LAST: 'multai:read-last',
  READ_LAST_RESULT: 'multai:read-last-result',
  READ_SELECTION: 'multai:read-selection',
  READ_SELECTION_RESULT: 'multai:read-selection-result',
  ERROR: 'multai:error'
};

export function extensionOrigin() {
  return `chrome-extension://${chrome.runtime.id}`;
}

export function sendToPane(iframe, origin, message, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!iframe?.contentWindow) {
      reject(new Error('pane not loaded'));
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = { ...message, _id: id };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`timeout waiting for ${message.type}`));
    }, timeoutMs);
    function onMessage(e) {
      if (e.source !== iframe.contentWindow) return;
      if (!e.data || e.data._replyTo !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (e.data.type === MSG.ERROR) reject(new Error(e.data.error || 'pane error'));
      else resolve(e.data);
    }
    window.addEventListener('message', onMessage);
    iframe.contentWindow.postMessage(payload, origin);
  });
}
