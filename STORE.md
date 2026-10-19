# Chrome Web Store listing copy

Reviewer- and user-facing copy for the Chrome Web Store submission. Numbers in
parentheses are CWS limits.

## Name

Companion for OpenCode

## Category

Productivity

## Single-purpose statement

Send selected text or page content from any website into your own local
opencode agent and chat with it in a side panel.

## Short description (≤ 132 characters)

```
Send pages and selections from any site into your local opencode agent — now with opencode v2 support. Unofficial and open-source.
```

(130 characters; matches `manifest.json` `description`.)

Alternative, if you'd rather lead with the panel (115 characters):

```
Send any page or selection to your local opencode agent and chat in the side panel. opencode v2 and v1. Unofficial.
```

## Detailed description

**Companion for OpenCode** pushes browser context into your local
[opencode](https://opencode.ai) agent — the AI coding tool you already run on
your own machine. It is unofficial and open-source, and not affiliated with
the opencode project.

Everything happens between this extension and an opencode server you run
yourself (by default `http://localhost:4096`). Nothing is sent to the
extension developer or to any third party.

### What's new in 1.0.0

- **opencode v2 support** — newer opencode servers replaced the old HTTP API
  and answer the old paths with the web UI's HTML, which made this extension
  report "server unreachable" on an otherwise healthy server. It now detects
  which API generation your server speaks and adapts to it, so both work in
  full: sessions, live streaming, slash commands, agent and model pickers,
  abort, delete. (v2 always requires basic auth with username `opencode`; enter
  the password from `OPENCODE_SERVER_PASSWORD` or the one your server prints at
  startup.)
- **Two delivery modes, not three** — the TUI delivery mode is gone, because v2
  removed the endpoints it used. The remaining modes are *New opencode session*
  and *Draft in side panel*.
- **Failed runs tell you why** — if a run dies server-side, for example because
  a model provider key expired, the panel now shows the error in the thread
  instead of showing nothing at all.

### Features

- **Works with opencode v2 and v1** — detects your server's API generation and
  adapts; basic auth (username `opencode`) is handled for either.
- **Send selection** — right-click on highlighted text (or press
  `Ctrl+Shift+U`) to send it to opencode.
- **Send page** — right-click anywhere to capture the whole page's text,
  truncated at a configurable limit.
- **GitHub-issue aware** — sending from a GitHub issue page adds structured
  issue context to the prompt.
- **Side panel** — browse your sessions, stream responses live, abort runs,
  create new sessions, run slash commands, and delete sessions (current or
  all extension-created ones).
- **Markdown replies** — assistant messages render as sanitized markdown;
  your own messages stay plain text.
- **Two delivery modes** — create a new opencode session, or draft the prompt in
  the side panel for review before sending.
- **Agent & model defaults** — pick a default agent and model in options.
- **Privacy by design** — captured web content is wrapped in explicit
  `UNTRUSTED CONTENT` delimiters with a guard note, because page content is
  data, never instructions.

### Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Save your settings and session list locally |
| `contextMenus` | Add the "Send selection/page to OpenCode" right-click items |
| `activeTab` + `scripting` | Capture the current page/selection only when you trigger a send |
| `sidePanel` | Show the chat panel |
| `notifications` | Show send confirmation / error feedback |
| `alarms` | Periodic health check (every 30s) so the toolbar badge reflects whether the local opencode server is reachable |
| `host_permissions` (`http://localhost/*`, `http://127.0.0.1/*`) | Reach your local opencode server |

The extension requests no permissions over arbitrary websites.

### Data usage disclosure

- Page content and selected text are sent **only** when you explicitly trigger
  an action, and **only** to the local opencode server you configure.
- Your server URL and password are stored locally in this browser
  (`chrome.storage.local`) and never synced or transmitted elsewhere.
- No analytics, no telemetry, no advertising, no third-party services.
- Data is never sold or shared.

See the [privacy policy](https://mmilidoni.github.io/opencode-companion/PRIVACY.html)
for the full details.

## Links

- Homepage / source: <https://github.com/mmilidoni/opencode-companion>
- Privacy policy: <https://mmilidoni.github.io/opencode-companion/PRIVACY.html>
- Support: <https://github.com/mmilidoni/opencode-companion/issues>
- Developer email: `michelemilidoni@gmail.com` (set in the CWS
  developer account, not in the listing)