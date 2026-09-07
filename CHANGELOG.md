# Changelog

All notable changes to this project are documented in this file.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are [SemVer](https://semver.org/)-style while in 0.x.

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
