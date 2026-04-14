// Preset semantics are declarative. Each per-provider object captures intent;
// provider modules translate this intent into real UI clicks against each
// site's current dropdowns and toggles.

export const PRESETS = [
  {
    id: 'deep-research',
    label: 'Deep research',
    description: 'Strongest reasoning model, thinking maxed, web search on where available.',
    perProvider: {
      chatgpt:  { model: 'top-reasoning', thinking: 'high', tools: ['web'] },
      claude:   { model: 'top',           thinking: { on: true, budget: 'max' }, tools: ['web', 'analysis'] },
      gemini:   { model: 'deep-research' },
      grok:     { model: 'top',           mode: 'deepsearch' },
      deepseek: { mode: 'deepthink' },
      qwen:     { thinking: true },
      meta:     { tools: ['web'] }
    }
  },
  {
    id: 'quick',
    label: 'Quick answer',
    description: 'Fast tier, no thinking, no tools.',
    perProvider: {
      chatgpt:  { model: 'fast',   thinking: 'off', tools: [] },
      claude:   { model: 'fast',   thinking: { on: false }, tools: [] },
      gemini:   { model: 'flash' },
      grok:     { model: 'fast',   mode: 'auto' },
      deepseek: { mode: 'chat' },
      qwen:     { thinking: false },
      meta:     { tools: [] }
    }
  },
  {
    id: 'code',
    label: 'Code task',
    description: 'Best coding model, thinking on, code/artifact tools on.',
    perProvider: {
      chatgpt:  { model: 'top',       thinking: 'medium', tools: ['code', 'canvas'] },
      claude:   { model: 'sonnet',    thinking: { on: true, budget: 'medium' }, tools: ['analysis', 'artifacts'] },
      gemini:   { model: 'pro',       tools: ['canvas'] },
      grok:     { model: 'expert' },
      deepseek: { model: 'coder' },
      qwen:     { model: 'coder' }
    }
  },
  {
    id: 'writing',
    label: 'Writing',
    description: 'Strongest prose model, no thinking, no tools.',
    perProvider: {
      chatgpt: { model: 'top',    thinking: 'off', tools: [] },
      claude:  { model: 'opus',   thinking: { on: false }, tools: [] },
      gemini:  { model: 'pro' },
      grok:    { model: 'top' }
    }
  },
  {
    id: 'blind',
    label: 'Blind taste test',
    description: 'Matched tiers; provider labels hidden until you reveal.',
    options: { blindLabel: true },
    perProvider: {
      chatgpt: { model: 'top' },
      claude:  { model: 'top' },
      gemini:  { model: 'pro' },
      grok:    { model: 'top' }
    }
  }
];

export function getPreset(id) {
  return PRESETS.find(p => p.id === id);
}
