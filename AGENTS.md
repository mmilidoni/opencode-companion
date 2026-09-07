# AGENTS.md

Manifest V3 browser extension (Chrome + Firefox) that pushes browser context
(selection / page) into a local [opencode](https://opencode.ai) server and
chats with it in a side panel / sidebar. TypeScript + esbuild, hand-written
manifest, no test framework.

## Commands (order matters)

- `npm run typecheck` — `tsc --noEmit`. **Run before every build**; esbuild does
  not type-check. This is the only automated check in the repo.
- `npm run build` — esbuild bundles `src/*` → **two targets**: `dist/` (Chrome,
  ESM `sw.js` module service worker) and `dist-firefox/` (self-contained
  Firefox extension, IIFE `sw.js` loaded as an event page). The
  `content/capture` entry only builds if the file exists — it doesn't, page
  capture uses inline `executeScript` funcs. `dist-firefox/manifest.json` is
  generated from `manifest.json` (gecko settings, `background.scripts`,
  `sidebar_action`, no `sidePanel` permission) — never hand-edit it.
- `npm run zip` — produces `opencode-companion-<version>.zip` with
  `manifest.json` at the zip root (CWS requirement). Version must stay aligned
  between `package.json` and `manifest.json`.
- `npm run zip:firefox` — produces `opencode-companion-<version>-firefox.zip`
  (xpi layout) from `dist-firefox/`.
- No tests exist. The safety net is `chrome://extensions` → Load unpacked →
  repo root (Chrome) and `about:debugging#/runtime/this-firefox` → Load
  Temporary Add-on → `dist-firefox/manifest.json` (Firefox), then the manual
  flows in `PLAN.md` §7 (Chrome) / §12.3 F6 (Firefox) acceptance criteria.
  `npx web-ext lint --source-dir dist-firefox` (one-off, not a devDep) is the
  only automated Firefox-side check — run it after manifest-relevant changes.

## Workflow conventions

- One branch per phase (`phase/N-*`), merged to `main` only after the phase's
  acceptance criteria pass. Never commit to `main` directly.
- `PLAN.md` is the authoritative design doc: API surface, permission model,
  risk register, phase structure. Read it before changing architecture.

## Release runbook

To cut a release, do all of these, in order — none is optional:

1. **Bump the version** in three files so they stay aligned: `package.json`
   (`version`), `manifest.json` (`version`), and `package-lock.json` (the root
   `version` **and** `packages[""].version`). 0.x SemVer: minor for a feature,
   patch for a fix.
2. **Update `CHANGELOG.md`** — Keep-a-Changelog style (`### Added` / `### Changed`
   / `### Fixed`) under a new `## [x.y.z] - YYYY-MM-DD` heading at the top.
3. **Refresh the store screenshots.** New captures land in `images/` (any size);
   reframe each into `images/store/<name>-1280x800.png`: a 1280×800 canvas with
   a `#F6F8FA` background, the capture scaled to fit (contain) and centered,
   high-quality bicubic interpolation. The marquee (`1400×560`) and promo tile
   (`440×280`) are branded icon graphics — regenerate only if the icon/branding
   changes.
4. **Build & verify, in order:**
   - `npm run typecheck` — must pass before building.
   - `npm run build` — both `dist/` and `dist-firefox/`.
   - `__PLATFORM__` check: `sidePanel` must be **absent** from `dist-firefox/`
     and `sidebarAction` **absent** from `dist/` (grep the minified bundles).
   - `npx web-ext lint --source-dir dist-firefox` — expect 0 errors (the 3×
     sanitized-`innerHTML` and Android `strict_min_version` warnings are known).
5. **Package** with `npm run zip` and `npm run zip:firefox`; confirm the zipped
   `manifest.json` version matches.
6. **Commit & tag:** put the work on a `phase/N-release-<version>` branch (never
   commit to `main` directly), merge to `main` with a `merge: release <version>`
   message, and add an annotated `v<version>` tag at the release commit.
7. **Keep docs current:** README (setup/usage), STORE.md (listing copy + the
   permission-justification table — any new permission must be added there),
   PLAN.md (acceptance criteria).

## opencode SDK — non-obvious constraints (verified against 1.18.27)

- **Always deep-import `@opencode-ai/sdk/client`.** The root entry
  `@opencode-ai/sdk` pulls in `server.js`, which imports Node-only
  `cross-spawn` and breaks the service-worker bundle.
- **The SDK has no `global.health()`** in 1.18.27 (`Global` only exposes
  `event()`). `health()` in `shared/opencode.ts` is a raw fetch to
  `/global/health`.
- **The SDK's SSE client calls global `fetch` and ignores a custom `fetch`** —
  basic auth would be silently dropped on `/event`. `eventSubscribe()` must
  pass the `Authorization` header via the `subscribe({ headers })` option
  (see `shared/opencode.ts`).
- **`session.promptAsync` exists** (maps to `POST /session/{id}/prompt_async`,
  204). All SDK calls in the facade use per-call `throwOnError: true` for
  honest return types; errors are normalized in `run()` to
  `unreachable | unauthorized | server | tui` kinds with no internal detail
  leakage. Never surface raw SDK errors in user-facing text.

## Service worker rules (MV3 gotchas)

- **No top-level `await` in `src/background/sw.ts`** — module service workers
  cannot evaluate it and registration fails with status 3. The settings cache
  is seeded from `DEFAULT_SETTINGS` and refreshed via `.then()`.
- **`openPanel()` in `src/shared/platform.ts` must be called synchronously
  inside the user gesture** — ANY await before it (storage read, `tabs.query`,
  network) invalidates the gesture, in Chrome (`chrome.sidePanel.open()`) and
  Firefox (`browser.sidebarAction.open()`, Mozilla bug 1800401). The shim is
  the ONLY place that calls either API — never call `chrome.sidePanel` or
  `browser.sidebarAction` directly. `contextMenus.onClicked` opens the panel
  first using the `tab` param; the keyboard command uses a tracked
  `activeWindowId`. Session selection after the (async) send is driven by
  `pendingSessionId` in storage, consumed by the panel on load, via a 1.5s
  poll, and a live `select-session` message.
- Health checks run on a `chrome.alarms` period (not a recursive `setTimeout`)
  so the badge stays fresh when a Firefox event page is suspended.
- SW does short-lived requests only (`prompt_async`, 204). SSE `/event` is
  consumed **only** from the side panel page, never the SW.
- Message protocol lives in `src/shared/types.ts` (`check-connection`,
  `select-session`). `chrome.runtime.sendMessage` rejects when no receiver —
  always `.catch(() => {})` on fire-and-forget sends.
- **`__PLATFORM__` is a compile-time esbuild define** (`"chrome"` / `"firefox"`,
  declared in `shared/platform.ts`, injected in `esbuild.config.mjs`). Each
  bundle dead-branch-eliminates the other platform's API (this relies on
  `minifySyntax: true`) — after touching `platform.ts`, grep the bundles:
  `sidePanel` must not appear in `dist-firefox/`, `sidebarAction` must not
  appear in `dist/`.

## Storage & data model

- Settings (`serverUrl`, `serverPassword`, `deliveryMode`, `autoSubmitTui`,
  `pageCharLimit`, `autoOpenPanel`, `agent`, `modelProviderId`, `modelId`) live
  in `chrome.storage.local` only — never `.sync`/`.session`. Password is never
  logged.
- `deliveryMode` is one of `headless` (create session + submit), `tui`
  (append to a TUI prompt), or `draft` — the **default** — which stages the
  capture in the panel (`pendingDraft` in storage) and submits nothing until
  the user sends from the panel. README documents only headless/tui; trust
  `DEFAULT_SETTINGS` in `shared/storage.ts`, which is the source of truth.
- **The side panel shows only sessions the extension created.** Session IDs
  are recorded in `extensionSessionIds` (capped at 1000) via
  `addExtensionSessionId()` — any new code path that creates a session must
  call it or the session won't appear in the panel.
- `health()` probes `/global/health` anonymously first to distinguish "server
  requires a password" from "server ignores passwords" (both are surfaced
  distinctly in the popup).

## Layout

- `src/background/sw.ts` — context menus, command handler, send pipeline
  (selection/page → `composePrompt` → headless session, TUI append, or draft).
- `src/shared/` — `opencode.ts` (SDK facade + auth), `storage.ts`,
  `platform.ts` (Chrome `sidePanel` ↔ Firefox `sidebarAction` shim),
  `prompt.ts` (untrusted-content delimiters + guard note; captured web content
  is data, never instructions), `types.ts`.
- `src/sidepanel/` — sessions dropdown, thread, streaming chat, slash-command
  runner, per-prompt model override. Assistant parts render as markdown via
  `marked` + `DOMPurify.sanitize` (**never** `innerHTML` with unsanitized
  text); user parts stay plain text. SSE text parts are keyed
  `${messageID}:${partID}` in `partEls`.
- `src/popup/` — quick config (URL, password, delivery mode, auto-open panel).
- `src/options/` — advanced config (`pageCharLimit`, `autoSubmitTui`) plus
  agent / provider / model pickers loaded from the server
  (`GET /app/agents`, `GET /config/providers`). Both pages write the same
  settings key; `storage.onChanged` refreshes SW and panel caches.
- `icons/` — committed PNGs; the generator was a throwaway PowerShell
  System.Drawing script (not checked in) — re-create it if icons must change.

## Environment quirks

- The dev machine has a global `OPENCODE_SERVER_PASSWORD` set, so freshly
  started `opencode serve` instances require basic auth (username `opencode`).
  The extension handles both auth and no-auth servers via the health probe.
- `opencode serve` and an opencode TUI cannot share a port; TUI mode requires
  `opencode --port <n>` (not `serve`) and the extension URL pointed at it.