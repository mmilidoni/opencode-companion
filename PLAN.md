# PLAN — "Companion for OpenCode" Chrome extension (MV3)

Status: approved for phased execution. Last updated: 2026-10-19.
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
  - **Draft** (default): creates a session and opens the side panel with the
    composed prompt pre-filled — nothing is submitted until the user reviews
    and sends from the panel, so no tokens are spent on auto-submit.
  - **Headless session**: `POST /session` → prompt (fire-and-forget; the prompt
    call enqueues and returns immediately on both API generations).
- Works with **opencode v1 and v2** servers — the API generation is detected at
  connect time (see §3).
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

## 3. Verified API surface

The extension supports **both** opencode API generations and picks one per
server at connect time.

### Detection

| Probe | v1 server | v2 server |
|---|---|---|
| `GET /api/info` | 404/HTML | `200` `{ version, pid, urls, paths }` |
| `GET /global/health` | `200` `{ healthy, version }` | SPA HTML at `200` |

Validation is by JSON **shape**, not status: a v2 server answers the legacy
paths with the web UI's HTML at `200`. `/api/info` is probed first (a JSON body
with a string `version` ⇒ v2), then `/global/health` (a JSON body with a
boolean `healthy` ⇒ v1).

### v1 surface (`@opencode-ai/sdk/client`, verified 1.18.27)

| Method | Path | Use |
|---|---|---|
| `GET` | `/global/health` | Connection check → `{ healthy, version }` |
| `POST` | `/session` | Create session, body `{ title }` |
| `GET` | `/session` | List sessions |
| `GET` | `/session/:id/message` | Message thread (parts) |
| `POST` | `/session/:id/prompt_async` | Send, no wait, `204` |
| `POST` | `/session/:id/abort` | Stop a running session |
| `POST` | `/session/:id/command` | Slash commands, body `{ command, arguments }` |
| `DELETE` | `/session/:id` | Delete a session |
| `GET` | `/event` | SSE bus |
| `GET` | `/config` | Merged config → default model resolution |
| `GET` | `/config/providers` | Provider list (with `models` maps) |
| `GET` | `/app/agents` | Agent list |

### v2 surface (raw `fetch` against `/api/*`, verified against server 2.0.32)

| Method | Path | Use |
|---|---|---|
| `GET` | `/api/info` | Connection check + version |
| `POST` | `/api/session` | Create session, body `{ title?, agent?, model? }` |
| `GET` | `/api/session` | List sessions → `{ data, cursor }` |
| `GET` | `/api/session/:id/message` | Message thread → `{ data, cursor }` (**newest-first**, capped at 50) |
| `POST` | `/api/session/:id/prompt` | Send, body `{ text, agent?, model? }` (returns immediately; execution streams on SSE) |
| `POST` | `/api/session/:id/interrupt` | Stop a running session (replaces `abort`) |
| `POST` | `/api/session/:id/command` | Slash commands, body `{ name, text }`, `204` |
| `DELETE` | `/api/session/:id` | Delete a session, `204` |
| `GET` | `/api/event` | SSE bus (`session.text.*`, `session.reasoning.*`, `session.step.*`, `session.tool.*`, `session.usage.updated`) |
| `GET` | `/api/model/default` (+ `/api/model`, `/api/provider`) | Default model / providers (no merged config on v2) |
| `GET` | `/api/agent` | Agent list |

v2 responses are wrapped (`{ data }`, `{ location, data }`, `{ data, cursor }`)
and are unwrapped in the facade. v2 has no merged-config endpoint, so the
default provider/model comes from `/api/model/default`. v2 event names are the
**server's** (`session.text.delta`), which differ from the 1.19.x SDK's
(`session.next.text.delta`), so the v2 client is hand-written rather than
SDK-driven.

### Auth

Both generations use HTTP basic auth, username `opencode`. v1 reads the
password from `OPENCODE_SERVER_PASSWORD`; v2 always requires auth and either
reads `OPENCODE_SERVER_PASSWORD` or generates a random password printed as
`server password <pw>` at startup. Sends from the service worker stay
short-lived (`POST .../prompt`); SSE `/event` is consumed only from the panel.

SDK: `@opencode-ai/sdk` → `createOpencodeClient({ baseUrl, fetch })`, deep
imported as `@opencode-ai/sdk/client` only (the root entry pulls Node-only
`cross-spawn`). The v2 path uses no SDK at all.

Two v2 server behaviours the client must absorb:

- `GET /api/session/:id/message` returns the thread **newest-first** (verified
  against 2.0.32), unlike v1's chronological `session.messages()`. The v2 impl
  restores chronological order so the panel renders top-to-bottom.
- A failed run yields an `assistant` message with `content: []` and an `error`
  object (`{type,message,status}`, e.g. `provider.auth` for an expired key), plus
  an `idle` message with `outcome: "failed"`. Both implementations therefore map
  a part-less assistant message to a facade message carrying `error` instead of
  dropping it, and the panel renders it.
- The SSE stream is bound to the URL/password it was opened with, so creating a
  new facade for changed settings requires re-subscribing (`sidepanel`).

---

## 4. Architecture

### Data flow

```
Context menu "Send selection" ──┐
   (selectionText, pageUrl,     ├→ service worker (short-lived ONLY: health,
    tab.title — no host perm)   │   session create, prompt)
Context menu "Send page" ───────┤
   (activeTab + scripting        │
    executeScript → innerText)   │
                                │   fetch http://localhost:4096  (host_permissions)
Popup (connection + config) ────┘   chrome.storage.local (password, settings)
Side panel (extension page) ── SDK client: sessions, chat, /event SSE (no SW)
```

### Non-negotiable design rules
1. **Service worker does short-lived requests only.** The prompt call enqueues
   and returns immediately (v1 `prompt_async` → `204`; v2
   `POST /api/session/:id/prompt` → the enqueued user message) — nothing
   long-lived survives the MV3 30s idle kill.
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
        ├── facade.ts             # version-agnostic API types (the seam)
        ├── result.ts             # Result<T> + OpenCodeError
        ├── opencode.ts           # detection + v1/v2 facade factory
        ├── opencode-v1.ts        # v1 impl (pinned @opencode-ai/sdk/client)
        ├── opencode-v2.ts        # v2 impl (hand-written /api/* client + SSE)
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
      `pageCharLimit`)
- [ ] 1.2 `shared/opencode.ts` — client factory: basic-auth fetch wrapper
      (`btoa`), `health()`, `createSession()`, `prompt()`, `listSessions()`,
      `listMessages()`, `abort()`
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
      (TUI delivery mode was removed for the v2 migration — see `CHANGELOG.md`.)
- [ ] 2.3 Page handler: `activeTab` + `scripting.executeScript` → `capture.ts`
      (`document.title` + URL + `document.body.innerText` truncated at
      `pageCharLimit`, default 20 000) → same send path
- [ ] 2.4 Command `send-selection` (Ctrl+Shift+U): active tab selection — the
      shortcut grants `activeTab`, so `executeScript` may read
      `window.getSelection()`; if empty, surface an in-extension message
      (no silent page fallback)
- **Accept:** select text on any page → send → `curl localhost:4096/session` shows the
  new session and message parts contain the selection + source URL + untrusted
  delimiters; page mode sends truncated `innerText`.
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
| **Prompt injection via page content** — a malicious page's text, sent to an agent with shell access, could carry hostile instructions | Med × High | Untrusted-content delimiters + guard note in every composed prompt; draft mode is the default, so nothing is submitted without a review |
| opencode API churn (v2 replaced the v1 HTTP surface wholesale) | Med × Med | Version detection + a version-agnostic facade (`shared/facade.ts`); v1 stays on the pinned SDK, v2 on a hand-written `/api/*` client |
| MV3 service-worker lifetime kills long connections | Was High → eliminated by design | `prompt_async` (204) in SW; SSE only in side panel (§4 rules) |
| SDK incompatible with service worker | Low × Med | Phase 0 decision gate; raw-fetch fallback for the §3 endpoints |
| CWS review friction | Low × Med | No `<all_urls>`; localhost-only hosts; strong privacy story; "X for OpenCode" third-party naming already established on CWS; "unofficial" + repo link in description |
| Password mishandling | Low × Med | `chrome.storage.local` only; never logged; basic-auth header constructed in memory |
| `activeTab` grant surprises (page send without user gesture) | Low × Med | All sends originate from a user gesture (context menu, shortcut, panel button) |
| Draft never sent (panel closed; orphaned `pendingDraft`) | Low × Low | `pendingDraft`/`pendingSessionId` are inert single-entry keys, cleared on the next panel load; draft mode also removes the auto-run exposure from the headless path |
| v2 event names drift from the SDK's (server 2.0.32 uses `session.text.delta`, the 1.19.x SDK `session.next.text.delta`) | Med × Med | v2 SSE is parsed by a hand-written mapper against the live server's names, plus a debounced thread reload as a safety net |
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

**Implemented 2026-09-07:**
6. Draft delivery mode — compose + create session + open the panel with a compact preview strip above the composer (label + truncated capture + discard); nothing submitted until the user sends. New default delivery mode. `pendingDraft` (structured: `sessionId`/`prompt`/`preview`/`label`) staged in `chrome.storage.local`, consumed by the panel after the pending session is selected; Send prepends any typed instruction to the capture.

**Still deferred:**
7. Remote servers via `optional_host_permissions` — needs the runtime `chrome.permissions.request` flow and a security pass (password leaves localhost); the manifest key stays removed from the shipped build until then
8. Firefox port (MV3) — planned in §12: no `chrome.sidePanel` (use `sidebar_action`), no module service worker

---

## 10. CWS submission checklist

- [x] Privacy policy drafted (`PRIVACY.md`, covers CWS data categories)
- [x] One-time $5 developer registration
- [x] Privacy policy live at public URL — GitHub Pages: merge `phase/4-cws` →
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
- [x] Developer email set in the CWS developer account
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
| Delivery | Headless session default; TUI mode opt-in → draft mode default (2026-09-07) → **TUI mode removed, v1+v2 support (2026-10-19)** | User feedback |
| Toolchain | esbuild + hand-written manifest (no wxt) | If multi-browser or HMR needed |
| Keybinding | Ctrl+Shift+U (send selection) | After first real usage |
| Phase 3 scope | Ship side panel + streaming chat in v0.1 | After first real usage |
| Side panel trigger | Popup button → `chrome.sidePanel.open()` (Chrome 116+) | — |

---

## 12. Firefox port (MV3) — plan

**Status:** implemented and verified 2026-09-05 — F0–F5 code + build pipeline
done; F6 manual verification passed in a real Firefox session (both delivery
modes, context-menu + shortcut sends, sidebar auto-open + session selection,
notifications, reconnect). Ready to merge to `main` after review. Decision
locked 2026-09-05: chat surface = `sidebar_action` (Firefox-native sidebar).
**Effort: ~3–3.5 person-days dev + AMO review latency (~1 week calendar).**
Single repo + platform shim, dual build output — **not** a hard fork (avoids
the drift warned about in §9).

### 12.1 What works as-is (verified against current Firefox MV3 docs)

- `chrome.storage.local`, `contextMenus`, `notifications`, `commands`, `action`
  badge, `scripting.executeScript`, `runtime` messaging. Firefox MV3 supports
  promises on the `chrome.*` namespace (so `.catch(() => {})` fire-and-forget
  sends behave like Chrome).
- SDK deep-import `@opencode-ai/sdk/client`, basic-auth fetch wrapper, and the
  SSE `/event` stream (fetch-based, not `EventSource`) — all environment-agnostic.
- Extension pages as ESM (`<script type="module">` + top-level `await`) — supported.
- `marked` + `dompurify` — pure JS, no browser coupling.
- Existing `host_permissions` (`http://localhost/*`, `http://127.0.0.1/*`) grant
  fetch-from-extension-pages access to localhost (CORS bypass) in Firefox MV3.

### 12.2 The gaps that cost

| # | Gap | Chrome | Firefox | Cost |
|---|---|---|---|---|
| 1 | Chat surface | `chrome.sidePanel` (114+) | No `sidePanel` API — `sidebar_action` (kept in MV3) | 1 day |
| 2 | Background | `service_worker` + `"type": "module"` | Event page (`background.scripts`, `persistent: false`); module SW unsupported → sw bundle IIFE, not ESM | ½ day |
| 3 | Manifest | `minimum_chrome_version` | `browser_specific_settings.gecko` (id + `strict_min_version`) | ¼ day |
| 4 | localhost fetch | host_permissions bypass CORS | Same patterns work, but auto-granted only from Firefox 127; on 109–126 must request at runtime or bump min version | ¼ day |
| 5 | Packaging | `scripts/zip.mjs` → CWS | `web-ext build`/`sign` → `.xpi` (same manifest-at-root layout) + AMO listing | ½ day |
| 6 | `chrome.sidePanel.open()` call sites | 3 sites (SW ×2, popup ×1) | `browser.sidebarAction.open()` behind a platform shim | folded into #1 |

### 12.3 Phases (each gated on review; rollback = delete the firefox branch)

- **F0 — Spike (½ day):** temporary-load in Firefox; prove (a) localhost
  `host_permissions` fetch works, (b) SDK SSE stream works, (c) sw bundles as
  IIFE and loads as an event page. Gates everything; downside bounded by the
  raw-fetch fallback already designed in `shared/opencode.ts`.
  - **Accept:** health probe green in the popup; `/event` streams into the
    side panel; badge updates.
- **F1 — Build + manifest (½ day):** conditional IIFE bundle for `sw` in
  `esbuild.config.mjs`; emit `dist-firefox/`; `background: { scripts: ["dist-firefox/sw.js"], persistent: false }`;
  `browser_specific_settings.gecko` with id + `strict_min_version: "127"`;
  drop `sidePanel` permission; add `sidebar_action` manifest key.
  - **Accept:** `npm run typecheck` clean; `web-ext run`/load-temporary loads
    without manifest warnings.
- **F2 — Panel shim (1 day):** `shared/platform.ts` — `isFirefox()` detection +
  `openPanel()` wrapper (`chrome.sidePanel.open({ windowId })` vs
  `browser.sidebarAction.open()`); replace the 3 call sites (SW context-menu
  path, SW command path, popup "Open panel" button).
  - **Gesture audit:** `sidebarAction.open()` carries the same
    synchronous-in-gesture rule (Mozilla bug 1800401). Existing
    `openPanelIfConfigured`/command handler already comply — verify, don't rewrite.
  - **Accept:** context menu, Ctrl+Shift+U, and popup button all open the
    sidebar; auto-open behavior matches Chrome.
- **F3 — Health poll (¼ day):** replace recursive `setTimeout` with
  `chrome.alarms` (supported in both) so the badge stays fresh when the event
  page sleeps.
  - **Accept:** badge reflects server state without the SW being force-awake.
- **F4 — Permission onboarding (¼ day):** `strict_min_version: "140.0"` chosen —
  140 is the ESR line and the first version with the built-in data-collection
  consent UI (so `data_collection_permissions` needs no custom consent
  handling); host permissions are shown + granted at install (Firefox 127+).
  Declared `required: ["websiteContent"]` — the only data transmitted, and it
  is the extension's core function. Runtime `permissions.request` path only if
  <140 support is ever required — deferred.
- **F5 — Packaging + AMO (½ day):** `web-ext build`/`sign` → `.xpi`; AMO
  listing from existing `STORE.md`/`PRIVACY.md`; human review adds days of
  latency, zero dev effort.
- **F6 — Verification (½–1 day):** both delivery modes (headless + draft),
  keyboard shortcut, notifications, sidebar open/close, reconnect after server
  restart, second machine.

### 12.4 Firefox risk register

| Risk | L×I | Mitigation |
|---|---|---|
| localhost fetch blocked by CORS/host-permission quirks | Med × High | F0 spike first; exact match patterns; runtime-request fallback for <127 |
| Event-page suspension kills `setTimeout` health poll → stale badge | Med × Med | `chrome.alarms` (F3), works in both browsers |
| `Ctrl+Shift+U` collides with a Firefox default | Low × Med | Verify in F6; user-remappable at `about:addons` |
| AMO review friction on localhost host_permissions | Low × Med | Same strong privacy story as CWS (§8) |
| `browser.sidebarAction` outside `@types/chrome` | Low × Low | Manual type declarations in `shared/platform.ts`; no new dev dependency (repo rule) |

### 12.5 Must vs nice-to-do

**Must:** F0–F3, F5–F6. **Nice-to-do:** F4 runtime-request path,
`_execute_sidebar_action` keyboard shortcut.

### 12.6 Rollback

All changes sit behind `shared/platform.ts` and a separate `dist-firefox/`
output; the Chrome manifest, Chrome esbuild path, and `scripts/zip.mjs` remain
untouched.