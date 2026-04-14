const COCKPIT_URL = chrome.runtime.getURL('src/cockpit/cockpit.html');

const PROVIDER_DOMAINS = [
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'grok.com',
  'deepseek.com',
  'qwen.ai',
  'meta.ai'
];

const HEADERS_TO_STRIP = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy'
];

async function ensureDynamicDNR() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const addRules = [{
      id: 1001,
      priority: 100,
      action: {
        type: 'modifyHeaders',
        responseHeaders: HEADERS_TO_STRIP.map(h => ({ header: h, operation: 'remove' }))
      },
      condition: {
        requestDomains: PROVIDER_DOMAINS,
        resourceTypes: ['main_frame', 'sub_frame']
      }
    }];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map(r => r.id),
      addRules
    });
    const now = await chrome.declarativeNetRequest.getDynamicRules();
    console.info('[multai] dynamic DNR active —', now.length, 'rule(s)');
  } catch (err) {
    console.error('[multai] DNR registration failed:', err);
  }
}

// Log every matched DNR rule (dev-mode only; silent in packed extensions)
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    console.debug('[multai] DNR matched:', info.rule.rulesetId, '#' + info.rule.ruleId, '→', info.request.url);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDynamicDNR();
  chrome.tabs.create({ url: COCKPIT_URL });
});

chrome.runtime.onStartup.addListener(ensureDynamicDNR);

chrome.action.onClicked.addListener(async () => {
  const existing = await chrome.tabs.query({ url: COCKPIT_URL });
  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: COCKPIT_URL });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'multai:open-in-tab' && message.url) {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'multai:debug-rules') {
    chrome.declarativeNetRequest.getDynamicRules().then(rules => sendResponse({ rules }));
    return true;
  }
  return false;
});
