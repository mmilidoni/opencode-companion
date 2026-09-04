# Privacy Policy

**Companion for OpenCode** ("the extension") is an unofficial, open-source
Chrome extension that connects your browser to an **opencode server you run
yourself** on your own machine.

*Last updated: 2026-09-04*

## What the extension does

The extension sends content from web pages you visit to a **local opencode
server** (by default `http://localhost:4096`). The server is software you
operate; nothing is sent to the extension developer or to any third party.

## Data collected and how it is used

- **Web content you choose to send.** The extension only captures page
  content or selected text when you explicitly trigger an action (right-click
  menu item, keyboard shortcut, or the side panel prompt box). It is sent to
  your own local opencode server as the prompt for an opencode session. The
  extension never reads or transmits page content automatically.
- **Server URL and password.** The server address and (optionally) the server
  password you configure are stored in `chrome.storage.local` on your machine
  only. They are never synced to a Google account and never transmitted
  anywhere except as the credentials used to authenticate to the local server
  you configured.
- **Session identifiers.** The extension records the identifiers of sessions
  it creates so the side panel can list them. This data stays in
  `chrome.storage.local` on your machine.

## What the extension does NOT do

- No analytics, no telemetry, no third-party services, no advertising.
- No collection of browsing history, cookies, or credentials.
- No communication with any server other than the local opencode server you
  configure (plus Chrome's own extension services).
- No automatic or background reading of page content.

## Data collection (Chrome Web Store categories)

| Category | Collected? | Details |
|---|---|---|
| Website content | Yes — only on explicit action | Page text or selected text you choose to send; transmitted to your local opencode server and nowhere else |
| Authentication information | Yes — if configured | The opencode server password you enter; stored in `chrome.storage.local` on your machine only |
| Web history | No | — |
| User activity | No | — |
| Personal communications | No | — |
| Location / Financial / Health / Personally identifiable information | No | — |

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Save your settings and session list locally |
| `contextMenus` | Add the "Send selection/page to OpenCode" right-click items |
| `activeTab` + `scripting` | Capture the current page/selection only when you trigger a send |
| `sidePanel` | Show the chat panel |
| `notifications` | Show send confirmation / error feedback |
| `host_permissions` (`http://localhost/*`, `http://127.0.0.1/*`) | Reach your local opencode server |

The extension requests no permissions over arbitrary websites.

## Data retention

All data is stored on your machine. Deleting the extension removes its stored
settings and session identifiers. Prompts are stored by your own opencode
server according to your server's configuration; the extension does not
retain any copies.

## Security note

Content from web pages is untrusted. The extension wraps captured content in
explicit delimiters and a guard note so the agent treats it as data, but the
agent you run may act on it — only use this extension with an opencode server
you trust.

## Changes to this policy

If this policy changes, the updated version will be posted here.

## Contact

Open an issue on the [extension repository](https://github.com/mmilidoni/opencode-companion).