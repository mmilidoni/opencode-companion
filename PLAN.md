# PLAN — "Companion for OpenCode" Chrome extension (MV3)

Status: approved for phased execution. Last updated: 2026-09-04.
Blast radius: **zero** — standalone repo; no code or dependencies shared with any
other project.

---

## 1. Overview

### Goal
A Manifest V3 Chrome extension that pushes browser context into a local
[opencode](https://opencode.ai) server. Right-click or shortcut to send the
selected text or the whole page as a prompt into an opencode session; side
panel for browsing sessions and streaming chat. Published on the Chrome Web
Store.

### In scope (MVP)
- Connect to a local `opencode serve` instance (default `http://localhost:4096`).
- Context-menu + keyboard-shortcut sends: **selection** and **page**.
- Two delivery modes:
  - **Headless session** (default): `POST /session` → `prompt_async` (fire-and-forget).
  - **TUI mode** (opt-in): push into a TUI the user already has open via
    `/tui/append-prompt` (append-only by default; auto-submit is a config flag, off).
- Side panel: session list, message thread, prompt box, abort, streaming via `/event` SSE.
- Chrome Web Store publication with minimal permissions.

### Non-goals (explicitly out)
- In-field completions / ghost text / autocomplete in web text fields (no typing
  observation, no caret overlay). This is what keeps the project ~3 weeks instead of months.
- Agent-driven browser control (CDP, tab driving, screenshots) — that direction is
  already crowded (see §2).
- Remote/cloud servers in MVP — deferred behind `optional_host_permissions`.
- Firefox port.

---

## 2. Landscape (researched 2026-09-04)

Every existing opencode↔browser extension does the **inverse** of this product —
the agent drives the browser:

| Project | Direction | Mechanism |
|---|---|---|
| opencode-chrome-bridge (pmgallardodev) | agent → browser | native messaging + CDP |
| opencode-chrome (G10hdz) | agent → browser | WebSocket bridge + CDP |
| opencode-chromium | agent → browser | native messaging host |
| OpenCode Browser (vymalo, on CWS) | agent → browser | localhost bridge + CDP |

Browser→agent capture exists **only in VS Code** today: the official opencode IDE
plugin and the third-party `opencode-selection` extension both push selection into
a running TUI via `/tui/append-prompt` on an internal port.

**Conclusion: the browser→agent lane is unclaimed on the Chrome Web Store.** The
differentiator is getting *browser* context (selection, page, URL, title) into the
*agent* — something the agent's own web UI (`opencode web`) cannot do.

---

## 3. Verified API surface (opencode server, docs updated 2026-09-04)

| Method | Path | Use |
|---|---|---|
| `GET` | `/global/health` | Connection check → `{ healthy, version }` |
| `POST` | `/session` | Create session, body `{ parentID?, title? }` |
| `GET` | `/session` | List sessions |
| `GET` | `/session/status` | Session statuses |
| `GET` | `/session/:id/message` | Message thread (parts) |
| `POST` | `/session/:id/message` | Send + wait (side-panel chat) |
| `POST` | `/session/:id/prompt_async` | **Send, no wait, `204` — the MV3-safe send path** |
| `POST` | `/session/:id/abort` | Stop a running session |
| `POST` | `/session/:id/command` | Slash commands (deferred) |
| `GET` | `/event` | SSE bus — first event `server.connected`, then events |
| `POST` | `/tui/append-prompt` | Append text to a running TUI's prompt |
| `POST` | `/tui/submit-prompt` | Submit the TUI's current prompt (opt-in) |
| `GET` | `/doc` | OpenAPI 3.1 spec (SDK source of truth) |

Auth: `OPENCODE_SERVER_PASSWORD` (HTTP basic auth, username defaults to
`opencode`). Server flags: `--port` (4096), `--hostname` (127.0.0.1), `--cors`
(only needed for `opencode web` at custom origins — the extension's
`chrome-extension://` pages bypass CORS via host_permissions). Message bodies
(`POST /session/:id/message`, `prompt_async`) take `parts: [{ type: "text", text }]`.

SDK: `@opencode-ai/sdk` → `createOpencodeClient({ baseUrl, fetch })`. Generated
from the OpenAPI spec; environment-agnostic (accepts a custom `fetch`).

---

## 4. Architecture

### Data flow

```
Context menu "Send selection" ──┐
   (selectionText, pageUrl,     ├→ service worker (short-lived ONLY: health,
    tab.title — no host perm)   │   session create, prompt_async, append-prompt)
Context menu "Send page" ───────┤
   (activeTab + scripting        │
    executeScript → innerText)   │
                                │   fetch http://localhost:4096  (host_permissions)
Popup (connection + config) ────┘   chrome.storage.local (password, settings)
Side panel (extension page) ── SDK client: sessions, chat, /event SSE (no SW)
```

### Non-negotiable design rules
1. **Service worker does short-lived requests only.** `prompt_async` returns
   `204` immediately — nothing long-lived survives the MV3 30s idle kill.
2. **SSE `/event` is consumed only from the side panel** (an extension page has
   no lifetime limit), via the SDK's `client.event.subscribe()` — never
   `EventSource` (it cannot send the basic-auth header). Never open an SSE
   stream from the service worker.
3. **Selection capture needs zero host permissions** — `OnClickData` provides
   `selectionText`, `pageUrl`, and `tab.title` for free.
4. **Password lives in `chrome.storage.local`, never `.sync`**, and never in
   `chrome.storage.session` (needed across SW restarts).
5. **Captured web content is untrusted** (see prompt-injection risk, §8): always
   wrapped in explicit delimiters with a guard note.

### Permission model (install prompt stays minimal)
- `permissions`: `storage`, `contextMenus`, `activeTab`, `scripting`, `sidePanel`, `notifications`
- `host_permissions`: `http://localhost/*`, `http://127.0.0.1/*` (match patterns
  ignore ports — any port matches; no `<all_urls>` anywhere)
- `optional_host_permissions`: `http://*/*`, `https://*/*` (future remote servers,
  requested at runtime — also required if `serverUrl` is set to a non-localhost
  host, e.g. a LAN IP or mDNS `opencode.local`)

---

## 5. Repo file tree

```
opencode-companion/
├── manifest.json                 # hand-written, static
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── .gitignore                    # dist/, node_modules/
├── README.md                     # setup: opencode serve, OPENCODE_SERVER_PASSWORD
├── PRIVACY.md                    # hosted on GitHub Pages for CWS
├── icons/                        # 16/48/128 (fresh SVG)
└── src/
    ├── background/sw.ts          # context menus, command handler, send pipeline
    ├── content/capture.ts        # injected on demand (activeTab): page → text
    ├── sidepanel/
    │   ├── sidepanel.html
    │   ├── sidepanel.ts          # sessions, thread, chat, SSE consumer
    │   └── sidepanel.css
    ├── popup/
    │   ├── popup.html            # connection status + quick config
    │   ├── popup.ts
    │   └── popup.css
    ├── options/
    │   ├── options.html          # advanced config (limits, mode flags)
    │   ├── options.ts
    │   └── options.css
    └── shared/
        ├── storage.ts            # typed chrome.storage.local wrapper
        ├── opencode.ts           # SDK/client factory + basic-auth fetch
        ├── prompt.ts             # prompt composition (untrusted-content wrapper)
        └── types.ts
```

esbuild bundles each entry to `dist/` preserving the subfolder layout so
`manifest.json` paths (`dist/sw.js`, `dist/popup/popup.html`, …) stay stable.
HTML/CSS are copied verbatim.

---

## 6. Manifest skeleton

```json
{
  "manifest_version": 3,
  "name": "Companion for OpenCode",
  "version": "0.1.0",
  "description": "Send selected text and page content from any website into your local opencode agent. Unofficial, open-source.",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "contextMenus", "activeTab", "scripting", "sidePanel", "notifications"],
  "host_permissions": ["http://localhost/*", "http://127.0.0.1/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "dist/sw.js", "type": "module" },
  "action": {
    "default_popup": "dist/popup/popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "side_panel": { "default_path": "dist/sidepanel/sidepanel.html" },
  "options_ui": { "page": "dist/options/options.html", "open_in_tab": true },
  "commands": {
    "send-selection": {
      "suggested_key": { "default": "Ctrl+Shift+U" },
      "description": "Send selection to OpenCode"
    }
  },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Note: `chrome.sidePanel` requires Chrome 114+; the popup's "Open side panel" button
uses `chrome.sidePanel.open()` (Chrome 116+, hence `minimum_chrome_version: "116"`);
`"type": "module"` service worker required for `import` of the SDK.

---

## 7. Phases (each gated on review; rollback = reset branch / delete repo)

### Phase 0 — Spike: connectivity proof (½ day)
- [ ] 0.0 `git init` + initial commit (branch-per-phase and rollback depend on it)
- [ ] 0.1 `npm init -y`; devDeps: `typescript`, `esbuild`, `@types/chrome`, `@opencode-ai/sdk`
- [ ] 0.2 `tsconfig.json` (strict), `esbuild.config.mjs` — bundle entries → `dist/`,
      copy HTML/CSS; per-entry format: `iife` for `content/capture.js` (content
      scripts are not ES modules), `esm` for `sw.js` + panel/popup/options
- [ ] 0.3 `manifest.json` per §6
- [ ] 0.4 `sw.ts`: on `runtime.onInstalled`, `fetch('http://localhost:4096/global/health')` →
      badge text/color (`OK`/version) or error state
- **Decision gate:** if `@opencode-ai/sdk` fails to import/bundle in a service worker
  (Node API leakage), drop to raw `fetch` for the §3 endpoints. Also verify
  `client.session.promptAsync` exists; if absent, raw-`fetch` that single
  `POST /session/:id/prompt_async` (204). Spike answers this before anything builds on it.
- **Accept:** `npx tsc --noEmit` clean; with `opencode serve` running, load unpacked →
  badge healthy; kill server → error state; restart → recovers.
- **Rollback:** delete repo.

### Phase 1 — Connection UX (1–2 days)
- [ ] 1.1 `shared/storage.ts` — typed `chrome.storage.local` wrapper
      (`serverUrl` default `http://localhost:4096`, `serverPassword`, `deliveryMode`,
      `autoSubmitTui`, `pageCharLimit`)
- [ ] 1.2 `shared/opencode.ts` — client factory: basic-auth fetch wrapper
      (`btoa`), `health()`, `createSession()`, `promptAsync()`, `listSessions()`,
      `listMessages()`, `abort()`, `appendPromptTui()`, `submitPromptTui()`;
      prompts sent as `parts: [{ type: "text", text }]` (raw strings 400)
- [ ] 1.3 `popup/` — status dot, URL + password fields, Test connection (shows
      version), Save; `background` handles `check-connection` message
- **Accept:** healthy server → green + version; wrong password → actionable error
  (no stack/URL leak in user-facing text); settings persist across browser restart.

### Phase 2 — Core MVP: browser → agent (2–3 days)
- [ ] 2.1 Register context menus in SW on install: **"Send selection to OpenCode"**
      (`contexts: ["selection"]`) and **"Send page to OpenCode"** (`contexts: ["page"]`)
- [ ] 2.2 Selection handler: compose prompt via `shared/prompt.ts` (untrusted wrapper:
      source URL + page title + delimiter + guard note) → mode A: `createSession`
      (title = page title) → `promptAsync` (body `parts`) → badge flash +
      `chrome.notifications.create`.
      Mode B (opt-in): `appendPromptTui`; **append-only unless `autoSubmitTui` is on**.
      TUI mode requires the TUI launched with a fixed port (`opencode --port 4096`) —
      `opencode serve` and a TUI cannot share the same port/URL.
- [ ] 2.3 Page handler: `activeTab` + `scripting.executeScript` → `capture.ts`
      (`document.title` + URL + `document.body.innerText` truncated at
      `pageCharLimit`, default 20 000) → same send path
- [ ] 2.4 Command `send-selection` (Ctrl+Shift+U): active tab selection — the
      shortcut grants `activeTab`, so `executeScript` may read
      `window.getSelection()`; if empty, surface an in-extension message
      (no silent page fallback)
- **Accept:** select text on any page → send → `curl localhost:4096/session` shows the
  new session and message parts contain the selection + source URL + untrusted
  delimiters; TUI mode visibly appends into a running `opencode` TUI (fixed `--port`);
  page mode sends truncated `innerText`.
- **Rollback:** drop Phase 2 branch; Phases 0–1 still shipped.

### Phase 3 — Side panel: sessions + streaming chat (3–5 days)
- [ ] 3.1 `sidepanel/` — session list (`GET /session`), thread (`GET /session/:id/message`),
      prompt box, abort button (`POST /session/:id/abort`); sends go through
      `prompt_async` (204, no blocking wait) and render from SSE — never the
      blocking `POST /session/:id/message` from the UI
- [ ] 3.2 Streaming: consume `/event` via the SDK's `client.event.subscribe()`
      (async-iterable stream over `fetch` — carries basic auth). **Never
      `EventSource`** — it cannot send the `Authorization` header. Render new
      assistant parts as they arrive (no SW involvement)
- [ ] 3.3 Rendering: plain text / `pre-wrap` only — **no markdown renderer in MVP**
      (hand-rolled renderers are an XSS hole; deferred to `marked` + `dompurify`)
- [ ] 3.4 Disconnected/empty states + recovery after server restart
- [ ] 3.5 Open affordance: popup button → `chrome.sidePanel.open({ windowId })`
      (Chrome 116+, hence `minimum_chrome_version: "116"`)
- **Accept:** full chat round-trip streams; abort stops a long run; kill/restart
  server → panel shows disconnected and recovers without reload.
- **Rollback:** drop Phase 3 branch; Phases 0–2 remain shippable.

### Phase 4 — CWS readiness (2–3 days)
- [ ] 4.1 Icons 16/48/128 (fresh SVG), options page (`options_ui`) absorbing advanced
      config from popup, `README.md`, `PRIVACY.md` published on GitHub Pages
- [ ] 4.2 `npm run zip` → CWS dashboard: $5 fee, single-purpose statement,
      per-permission justification, data-use disclosure (page content → user's own
      local server; nothing to any third party), 1280×800 screenshots
- **Accept:** install from zip into a clean Chrome profile; permission prompt shows
  no "all websites" language; end-to-end passes on a second machine.
- **Rollback:** unpublished at any time; source remains usable unpacked.

---

## 8. Risk register

| Risk | L×I | Mitigation |
|---|---|---|
| **Prompt injection via page content** — a malicious page's text, sent to an agent with shell access, could carry hostile instructions | Med × High | Untrusted-content delimiters + guard note in every composed prompt; TUI mode append-only by default; auto-submit flag off by default |
| opencode API churn (`/tui/*` is IDE-plugin-coupled; server API evolves) | Med × Med | Pin SDK version; headless session mode is the default (documented public surface); TUI mode labeled experimental in options |
| MV3 service-worker lifetime kills long connections | Was High → eliminated by design | `prompt_async` (204) in SW; SSE only in side panel (§4 rules) |
| SDK incompatible with service worker | Low × Med | Phase 0 decision gate; raw-fetch fallback for the §3 endpoints |
| CWS review friction | Low × Med | No `<all_urls>`; localhost-only hosts; strong privacy story; "X for OpenCode" third-party naming already established on CWS; "unofficial" + repo link in description |
| Password mishandling | Low × Med | `chrome.storage.local` only; never logged; basic-auth header constructed in memory |
| `activeTab` grant surprises (page send without user gesture) | Low × Med | All sends originate from a user gesture (context menu, shortcut, panel button) |
| TUI mode silently broken (TUI on a random port / no TUI attached to that server) | Med × Med | README + options mandate `opencode --port <n>`; surface an actionable "TUI unreachable" error |
| SSE auth impossible via `EventSource` | Med × High | Eliminated by design — SDK `event.subscribe()` (fetch-streaming) in the panel (§3.2) |
| SDK lacks `promptAsync` | Low × Med | Phase 0 gate verifies; raw-fetch fallback for that one endpoint |

---

## 9. Must-do vs nice-to-do

**Must:** Phases 0–3 (context-menu sends + side panel with streaming chat), Phase 4 store hygiene.

**Nice-to-do — implemented 2026-09-04, merged into `phase/4-cws`:**
1. Markdown rendering — `marked` + `dompurify`; assistant parts rendered sanitized, user parts stay plain text
2. `/session/:id/command` slash-command UI — command dropdown + args row in the side-panel composer
3. Agent/model pickers — global defaults in options (`GET /app/agents` + `GET /config/providers`); applied per-prompt via `prompt_async`, not at session creation (session create accepts no agent/model)
4. GitHub-issue-aware capture — `parseGithubIssue()` adds structured issue context (owner/repo/number) to composed prompts
5. Session deletion — side-panel "Delete" (current) and "Delete all" (all extension-created sessions), both `confirm()`-gated; `DELETE /session/{id}` per session (no bulk endpoint)

**Still deferred:**
6. Remote servers via `optional_host_permissions` — needs the runtime `chrome.permissions.request` flow and a security pass (password leaves localhost); the manifest key stays removed from the shipped build until then
7. Firefox port (MV3) — a fork, not a feature: no `chrome.sidePanel` (use `sidebar_action`), no module service worker

---

## 10. CWS submission checklist

- [x] Privacy policy drafted (`PRIVACY.md`, covers CWS data categories)
- [ ] One-time $5 developer registration
- [ ] Privacy policy live at public URL — GitHub Pages: merge `phase/4-cws` →
      `main`, push, then Settings → Pages → Deploy from a branch → `main` / `(root)`;
      verify `https://mmilidoni.github.io/opencode-companion/PRIVACY.html` (root
      `index.html` is the landing page; don't rename the repo — the URL is tied to it)
- [x] Single-purpose statement, short/detailed description, permission
      justification, data-use disclosure — `STORE.md`
- [x] Screenshots 1280×800 — `images/store/` (context menu, options page, popup,
      sidebar)
- [x] Small promo tile 440×280 + marquee 1400×560 — `images/store/` (branded
      graphics from the icon; optional, recommended)
- [x] `npm run zip` artifact; version matches `manifest.json` and `package.json`
- [x] Naming: "Companion for OpenCode", description notes "unofficial", links repo
- [ ] Developer email set in the CWS developer account
- [x] `optional_host_permissions` removed from manifest for the first review
      (re-add only when remote servers ship — §9 item 6)

---

## 11. Verification protocol

- `npx tsc --noEmit` **before every build** (esbuild does not type-check).
- `npm run build` then `chrome://extensions` → Load unpacked → `dist/` (or repo root).
- Manual test per phase acceptance criteria above; **no test infrastructure** — the
  load-unpacked loop is the safety net.
- Real-server checks via `curl http://localhost:4096/...` against a scratch project.
- Never commit to `main` directly: one branch per phase, merged only after the
  phase's acceptance criteria pass.

---

## Resolved decisions (2026-09-04)

| Decision | Choice | Revisit when |
|---|---|---|
| Name | "Companion for OpenCode", repo `opencode-companion` | Before CWS submission |
| Client | `@opencode-ai/sdk` via `createOpencodeClient({ baseUrl, fetch })` + raw-fetch fallback | Phase 0 gate fails |
| Delivery | Headless session default; TUI mode opt-in | User feedback |
| Toolchain | esbuild + hand-written manifest (no wxt) | If multi-browser or HMR needed |
| Keybinding | Ctrl+Shift+U (send selection) | After first real usage |
| Phase 3 scope | Ship side panel + streaming chat in v0.1 | After first real usage |
| Side panel trigger | Popup button → `chrome.sidePanel.open()` (Chrome 116+) | — |