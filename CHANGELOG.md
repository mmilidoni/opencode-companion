# Changelog

All notable changes to this project are documented in this file.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [1.0.0] - 2026-10-19

First stable release: the extension works with both opencode server generations.

### Added

- **opencode v2 support** — the extension now detects whether the server speaks
  the v2 `/api/*` HTTP API or the legacy v1 API and adapts to either. v2
  `opencode serve` always requires basic auth (username `opencode`; password
  from `OPENCODE_SERVER_PASSWORD` or the one printed at startup), so the v1
  health probe no longer reports a v2 server as unreachable.

### Changed

- **TUI delivery mode removed** — v2 dropped `/tui/append-prompt` and
  `/tui/submit-prompt`. The remaining delivery modes are *New opencode session*
  and *Draft in side panel*; the `autoSubmitTui` setting is gone and any stored
  `tui` delivery mode falls back to draft.
- The internal API facade is now version-agnostic: consumers talk in normalized
  types (`FacadeSession`, `FacadeMessage`, `FacadeStreamEvent`, …) and the v1
  (SDK) and v2 (raw `/api/*`) implementations normalize underneath.
- v2 streaming is parsed from `/api/event` SSE frames (`session.text.*` deltas
  accumulated into parts), with a debounced thread reload as a safety net.
- Default provider/model resolution uses the server's default model on v2
  (there is no merged config endpoint) instead of `GET /config`.

### Fixed

- **v2 threads rendered in reverse** - `/api/session/:id/message` returns the
  thread newest-first, so the panel showed the newest message at the top and
  the assistant's reply landed above the prompt, off-screen in a long thread.
  The v2 client now restores chronological order.
- **Streaming stayed dead after a settings change** - the panel's `/api/event`
  subscription was opened with the URL/password it booted with; changing either
  only rebuilt the request facade, so replies stopped arriving until the panel
  was reopened. The subscription is now replaced when the server settings change.
- **Failed assistant messages were silently dropped** - a run that ends in a
  server-side error (expired provider key, aborted step) produces an assistant
  message with no text parts, which both implementations mapped to `null`. The
  panel showed the prompt with no reply and no explanation. Messages now carry
  the reported error and the panel renders it in the thread.

## [0.3.0] - 2026-09-07

### Added

- **Draft delivery mode (new default)** — sending a selection or page now
  stages the prompt in the side panel as a compact preview strip (label +
  truncated capture + discard) instead of submitting immediately. Nothing is
  sent and no tokens are spent until you press **Send** from the panel; the
  panel opens automatically in draft mode even when auto-open is off. Switch
  back to instant delivery ("New opencode session" or "Open TUI prompt") in
  the options page.
- **Default model resolution** — the extension reads the server's merged
  config (`GET /config`) to resolve the default provider/model; the options
  page model dropdown also seeds the currently selected model when the
  provider exposes no model list.

### Changed

- Popup simplified to server URL / password / connection test — delivery mode
  and auto-open behaviour now live in the options page only.
- Refreshed Chrome Web Store screenshots (side panel, context menu, popup,
  options page) from new captures.

## [0.2.0] - 2026-09-07

### Added

- **Firefox support (MV3)** — chat in Firefox's native sidebar
  (`sidebar_action`); background runs as an event page (IIFE bundle) with
  `chrome.alarms` health checks. Requires Firefox 140+. Load via
  `about:debugging` → `dist-firefox/manifest.json`; packaged with
  `npm run zip:firefox` (xpi layout). Validated with `web-ext lint` (0 errors).
- **Per-prompt model override** — model dropdown in the side panel composer,
  seeded from the provider selected in options.
- This changelog.

### Changed

- `npm run build` now emits both targets: `dist/` (Chrome, module service
  worker) and `dist-firefox/` (self-contained Firefox extension whose
  `manifest.json` is generated from the hand-written source manifest).
- Health checks run on a `chrome.alarms` period instead of a recursive
  `setTimeout` so the badge stays fresh when the Firefox event page is
  suspended (adds the `alarms` permission).
- `src/shared/platform.ts` is the only place that opens the chat surface;
  the other platform's API is dead-branch-eliminated from each bundle via the
  compile-time `__PLATFORM__` define.

## [0.1.0] - 2026-09-04

### Added

- Initial release.
- **Send selection / page to OpenCode** — context menu or `Ctrl+Shift+U`
  pushes captured browser context (selection or page text, URL, title) into a
  local opencode server. Page content is wrapped in untrusted-content
  delimiters with a guard note; GitHub issue pages add structured
  owner/repo/#number context.
- **Two delivery modes** — headless session (default, via `prompt_async`) or
  append to a running TUI (append-only by default; auto-submit opt-in).
- **Side panel** — session list (extension-created sessions only), streaming
  chat over the server's `/event` SSE bus, abort, new sessions, sanitized
  markdown replies, slash-command runner, agent/model defaults, and deletion
  of the current or all extension-created sessions.
- **Connection UX** — popup for server URL / password / delivery mode with an
  auth-aware health probe; options page for advanced settings (page character
  limit, TUI auto-submit, agent/provider/model pickers).
- Chrome Web Store packaging (`npm run zip`), store listing copy
  (`STORE.md`), and privacy policy (`PRIVACY.md`).
