# Companion for OpenCode

A Manifest V3 Chrome extension that pushes browser context into your local
[opencode](https://opencode.ai) agent. Right-click or use a shortcut to send
the selected text or the whole page into an opencode session; the side panel
lets you browse sessions and watch responses stream in.

Unofficial and open-source — not affiliated with the opencode project.
Source: [github.com/mmilidoni/opencode-companion](https://github.com/mmilidoni/opencode-companion).

## Features

- **Send selection** — right-click → *Send selection to OpenCode*, or press
  `Ctrl+Shift+U` on a page with selected text.
- **Send page** — right-click on any page → *Send page to OpenCode* (page text
  captured as `innerText`, truncated at the configured limit).
- **GitHub-issue aware** — sending from a GitHub issue page adds structured
  issue context (owner/repo/number) to the prompt.
- **Two delivery modes**:
  - *New opencode session* (default): creates a session on the server and
    sends the prompt asynchronously.
  - *Open TUI prompt*: appends the prompt into an opencode TUI running on the
    server port (append-only by default; auto-submit is opt-in).
- **Side panel** — session list, streaming chat over the server's `/event`
  SSE bus, abort, new-session creation, slash commands, and session deletion
  (current or all extension-created sessions). Auto-opens and selects the new
  session when you send from a page (toggleable).
- **Markdown replies** — assistant messages render as sanitized markdown
  (code blocks, lists, tables); your own messages stay plain text.
- **Agent & model defaults** — set a default agent and model in options,
  applied to every prompt the extension sends.
- Captured content is wrapped in explicit `UNTRUSTED CONTENT` delimiters with a
  guard note, because page content is data, never instructions.

## Requirements

- Chrome 116 or newer, **or** Firefox 140 or newer (Firefox uses the native
  sidebar — `sidebar_action` — instead of Chrome's side panel)
- [opencode](https://opencode.ai) CLI with a running server

## Setup

### 1. Run the opencode server

```sh
opencode serve --port 4096 --hostname 127.0.0.1
```

Optional: protect it with basic auth.

```sh
OPENCODE_SERVER_PASSWORD=your-password opencode serve --port 4096
```

The extension defaults to `http://localhost:4096`; change it in the popup or
the options page.

### 2. Build and load the extension

```sh
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder (the one containing `manifest.json`)

### 2b. Firefox build

The same `npm run build` also emits `dist-firefox/`, a self-contained Firefox
extension. To load it temporarily:

1. Go to `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `dist-firefox/manifest.json`

The chat surface opens in Firefox's native sidebar (`sidebar_action`) instead
of a side panel; everything else behaves the same.

### 3. Configure

Open the popup: set the server URL (and password, if the server requires one),
pick the delivery mode, and hit **Save**. The status dot shows whether the
server is reachable and whether it requires a password. Advanced options
(page character limit, TUI auto-submit, agent & model defaults) live in the
options page (right-click the extension → Options).

## Usage

- Select text → right-click → **Send selection to OpenCode**
- Right-click anywhere on a page → **Send page to OpenCode**
- `Ctrl+Shift+U` — send the current selection (Chrome maps extension
  shortcuts; if the default conflicts, reassign it at `chrome://extensions/shortcuts`)
- Click the extension popup → **Open side panel** to browse sessions and chat
- When *Auto-open side panel after sending* is on, sending from a page opens
  the panel and selects the new session automatically

## TUI mode

Run the TUI with a fixed port and point the extension at it:

```sh
opencode --port 4096
```

Then set *Deliver to* → *Open TUI prompt*. Sends append to the TUI's prompt
box; nothing is submitted unless you press Enter in the TUI (or enable
auto-submit in options). Note that `opencode serve` and a TUI cannot share a
port.

## Permissions

- `storage` — settings and the list of sessions this extension created
- `contextMenus`, `activeTab`, `scripting` — the send-selection / send-page
  actions
- `sidePanel` — the chat panel
- `notifications` — send confirmation and error feedback
- `alarms` — periodic server-health checks for the badge
- `host_permissions`: `http://localhost/*`, `http://127.0.0.1/*` only — no
  `<all_urls>`, no remote servers

See [PRIVACY.md](./PRIVACY.md) for the full privacy policy.

## Development

```sh
npm run typecheck   # tsc --noEmit (run before every build)
npm run build       # esbuild bundles src/ -> dist/ (Chrome) and dist-firefox/ (Firefox)
npm run zip         # package the Chrome build for the Chrome Web Store
npm run zip:firefox # package dist-firefox/ (xpi layout) for AMO
```

## License

MIT