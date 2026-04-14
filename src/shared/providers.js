export const PROVIDERS = [
  { id: 'chatgpt',  label: 'ChatGPT',   url: 'https://chatgpt.com/',          temporaryUrl: 'https://chatgpt.com/?temporary-chat=true',   origin: 'https://chatgpt.com',       hasContentScript: true },
  { id: 'claude',   label: 'Claude',    url: 'https://claude.ai/new',         temporaryUrl: 'https://claude.ai/new?incognito',            origin: 'https://claude.ai',         hasContentScript: true },
  { id: 'gemini',   label: 'Gemini',    url: 'https://gemini.google.com/app',                                                             origin: 'https://gemini.google.com', hasContentScript: true },
  { id: 'grok',     label: 'Grok',      url: 'https://grok.com/',                                                                         origin: 'https://grok.com',          hasContentScript: true },
  { id: 'meta',     label: 'Meta AI',   url: 'https://www.meta.ai/',                                                                      origin: 'https://www.meta.ai',       hasContentScript: true },
  { id: 'deepseek', label: 'DeepSeek',  url: 'https://chat.deepseek.com/',                                                                origin: 'https://chat.deepseek.com', hasContentScript: true },
  { id: 'qwen',     label: 'Qwen',      url: 'https://chat.qwen.ai/',         temporaryUrl: 'https://chat.qwen.ai/?temporary-chat=true',  origin: 'https://chat.qwen.ai',      hasContentScript: true }
];

export const DEFAULT_CREW = ['chatgpt', 'claude', 'gemini', 'grok'];

export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id);
}
