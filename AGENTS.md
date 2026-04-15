# AGENTS.md — MultAI

## Project overview

MultAI is a **Chrome extension** (Manifest V3) that embeds multiple AI chat providers (ChatGPT, Claude, Gemini, Grok, Meta AI, DeepSeek, Qwen) as iframes inside a single "cockpit" tab. Users type one prompt and broadcast it to all active providers simultaneously. There is **no backend server** — each iframe runs the real provider site under the user's own login, and all data stays in `chrome.storage.local`.

## Tech stack

- **Plain JavaScript** (ES modules for extension pages, IIFE for content scripts). No TypeScript.
- **Plain CSS** + Google Fonts. No preprocessors or CSS frameworks.
- **No build step.** Load the repo folder directly as an unpacked Chrome extension.
- **No npm/yarn dependencies.** No `package.json`, no `node_modules`.
- **No CI/CD, linter, or formatter** configured in the repo.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Extension pages (chrome-extension://...)            │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ cockpit.js   │  │ options.js │  │ service-     │  │
│  │ (main UI)    │  │ (settings) │  │ worker.js    │  │
│  └──────┬───────┘  └─────┬──────┘  └──────┬───────┘  │
│         │                │                │          │
│         │  chrome.storage.local           │ DNR      │
│         │  ◄─────────────┘         rules ─┘          │
│         │                                            │
│         │  postMessage (multai:*)                    │
│         ▼                                            │
│  ┌──────────────────────────────────┐                │
│  │  Provider iframes                │                │
│  │  anti-framebust.js (MAIN world)  │                │
│  │  _runtime.js + content.js        │                │
│  └──────────────────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

**Embedding flow:** Static + dynamic `declarativeNetRequest` rules strip framing headers (X-Frame-Options, CSP, COOP, COEP, CORP, Permissions-Policy). `anti-framebust.js` runs in MAIN world at `document_start` to neutralize JS-based frame-busting.

**Communication:** Cockpit ↔ provider content scripts talk via `window.postMessage` with `multai:*`-prefixed message types. `sendToPane()` in `src/shared/messaging.js` posts a message and awaits a reply matched by `_replyTo`.

**Readiness:** After an iframe loads, cockpit sends `multai:wake` on an interval until the content script replies `multai:ready`.

## Directory layout

```
manifest.json              Extension manifest (MV3)
rules/iframe-headers.json  Static DNR rules for header stripping
assets/                    Icons (icon.svg; PNGs referenced but may be missing)
src/
  background/
    service-worker.js      DNR setup, action click handler, tab management
  cockpit/
    cockpit.html/css/js    Main UI: pane grid, broadcast, compare, bench, library
  options/
    options.html/css/js    Settings page: crew toggles, plan display, storage reset
  shared/
    providers.js           Provider registry (ids, labels, URLs, origins)
    messaging.js           MSG constants, sendToPane() helper
    attachments.js         File size/name utilities
    anti-framebust.js      MAIN-world frame-busting countermeasure
    design-tokens.css      Shared CSS variables
  providers/
    _runtime.js            Shared content-script framework (register(), DOM helpers)
    chatgpt/content.js     ChatGPT automation (standalone, does not use _runtime)
    claude/content.js      Claude automation (uses _runtime.register)
    gemini/content.js      Gemini automation
    grok/content.js        Grok automation
    meta/content.js        Meta AI automation
    deepseek/content.js    DeepSeek automation
    qwen/content.js        Qwen automation
```

## Key modules

| Module | Responsibility |
|--------|---------------|
| `src/shared/providers.js` | Single source of truth for provider metadata: id, label, default URL, temporary-chat URL, `postMessage` origin. Exports `DEFAULT_CREW`. |
| `src/shared/messaging.js` | Message protocol constants (`MSG.WAKE`, `MSG.BROADCAST`, etc.) and `sendToPane()` with timeout support. |
| `src/cockpit/cockpit.js` | Main UI controller. Manages pane lifecycle, layout (grid/tabs), broadcast dispatch, Compare drawer, prompt library, bench, keyboard shortcuts. State persists via `chrome.storage.local` under `multai.*` keys. |
| `src/providers/_runtime.js` | MAIN-world shared framework. Provides `setPrompt`, `submit`, `attachFiles`, `readLast`, and `register(config)` which wires up the `postMessage` listener for all standard operations. |
| `src/providers/*/content.js` | Per-provider selectors and overrides. ChatGPT is standalone; all others call `__multaiRuntime.register({...})`. |
| `src/background/service-worker.js` | Installs dynamic DNR rules, opens/focuses cockpit on action click, handles `multai:open-in-tab`. |

## Conventions

- **Message prefix:** All cross-context message types use the `multai:` prefix (e.g. `multai:wake`, `multai:broadcast`, `multai:ready`).
- **Storage keys:** All `chrome.storage.local` keys are prefixed with `multai.` (e.g. `multai.state`, `multai.plans`, `multai.library`).
- **Console logging:** Use `[multai]` or `[multai-<provider>]` prefixes for all `console.log`/`console.warn` output.
- **Provider content scripts:** Place selectors at the top of each `content.js` for easy patching when provider sites change their DOM.
- **Error handling:** Wrap brittle DOM queries and `postMessage` paths in try/catch.
- **Privacy:** No data leaves the browser. Never introduce external analytics, telemetry, or proxy servers.

## Adding a new provider

1. Add the provider entry to `src/shared/providers.js` (id, label, url, origin, optionally temporaryUrl).
2. Create `src/providers/<id>/content.js` implementing the provider contract. Use `__multaiRuntime.register({...})` from `_runtime.js` — implement at minimum `selectors`, `probe()`, `broadcast()`, `readLast()`.
3. Register content script injection in `manifest.json` under `content_scripts` (match the provider's URL pattern; inject `_runtime.js` then `content.js` in MAIN world).
4. Add the provider's domain to `host_permissions` and the DNR header-stripping rules in both `rules/iframe-headers.json` and the dynamic rules in `service-worker.js`.
5. Add the provider's origin to `content_security_policy.extension_pages` `frame-src`.
6. Add an `anti-framebust.js` content script entry if the provider uses JS-based frame-busting.

## Running locally

1. Open Chrome → `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** → select this repository folder.
3. Click the MultAI toolbar icon to open the cockpit.
4. Log into each AI provider in its respective pane.

No build, install, or compile step is required.

## Important constraints

- **No build system.** All JS must be valid for Chrome's V8 without transpilation. Do not introduce JSX, TypeScript, or syntax requiring a build step unless the project explicitly migrates.
- **Manifest V3 restrictions.** No `eval()`, no remote code loading. Service worker is event-driven (no persistent background page).
- **Content script worlds.** `anti-framebust.js` and `_runtime.js` + `content.js` run in **MAIN world** (share the page's JS context). Be careful with variable naming to avoid collisions with provider site code.
- **Provider site fragility.** Provider DOM selectors break frequently. Keep selectors isolated at the top of each content script and document what each one targets.
- **Icon assets.** `manifest.json` references PNG icons (`assets/icons/icon16.png` through `icon128.png`) that may not exist locally — only `assets/icon.svg` is checked in. Generate PNGs from the SVG if Chrome warns about missing icons.
