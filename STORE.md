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
Send selected text and page content from any website into your local opencode agent. Unofficial, open-source.
```

(99 characters; matches `manifest.json` `description`.)

## Detailed description

**Companion for OpenCode** pushes browser context into your local
[opencode](https://opencode.ai) agent — the AI coding tool you already run on
your own machine. It is unofficial and open-source, and not affiliated with
the opencode project.

Everything happens between this extension and an opencode server you run
yourself (by default `http://localhost:4096`). Nothing is sent to the
extension developer or to any third party.

### Features

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
- **Two delivery modes** — create a new opencode session, or append into an
  opencode TUI you already have open.
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
- Developer email: `TODO — required at submission time` (set in the CWS
  developer account, not in the listing)