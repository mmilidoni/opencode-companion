import { createOpenCodeApi } from "../shared/opencode.js";
import type { OpenCodeError } from "../shared/opencode.js";
import { composePrompt, parseGithubIssue } from "../shared/prompt.js";
import type { ContentKind, PromptSource } from "../shared/prompt.js";
import { getSettings, DEFAULT_SETTINGS, addExtensionSessionId, setPendingSessionId } from "../shared/storage.js";
import type { Settings } from "../shared/storage.js";
import type { BackgroundMessage, CheckConnectionResultMessage } from "../shared/types.js";
import type { TextPartInput } from "@opencode-ai/sdk/client";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const BADGE_FLASH_MS = 2_500;

const MENU_SEND_SELECTION = "send-selection";
const MENU_SEND_PAGE = "send-page";
const COMMAND_SEND_SELECTION = "send-selection";

// Cached so gesture handlers can read autoOpenPanel without any await —
// chrome.sidePanel.open() requires being called synchronously in the
// user-gesture handler (any async gap before it invalidates the gesture).
// No top-level await: module service workers can't evaluate it, so the
// cache starts at the defaults and refreshes as soon as the SW wakes.
let cachedSettings: Settings = DEFAULT_SETTINGS;
void getSettings().then((settings) => {
  cachedSettings = settings;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    cachedSettings = { ...cachedSettings, ...(changes.settings.newValue as Settings) };
  }
});

function setBadge(state: "ok" | "error" | "unknown"): void {
  const color = state === "ok" ? "#22c55e" : state === "error" ? "#ef4444" : "#6b7280";
  const text = state === "ok" ? "OK" : state === "error" ? "ERR" : "…";
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
}

function flashBadge(): void {
  void chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  void chrome.action.setBadgeText({ text: "✓" });
  setTimeout(() => {
    void checkHealth();
  }, BADGE_FLASH_MS);
}

async function checkHealth(): Promise<void> {
  const settings = await getSettings();
  const api = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
  const result = await api.health();
  setBadge(result.ok ? "ok" : "error");
}

function scheduleHealthCheck(): void {
  setTimeout(() => {
    void checkHealth();
    scheduleHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
}

function notify(id: string, title: string, message: string): void {
  void chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

function describeSendError(error: OpenCodeError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Authentication failed — check the server password in settings.";
    case "unreachable":
      return "Could not reach the opencode server — is `opencode serve` running?";
    case "server":
      return `Server error (${error.status}).`;
    case "tui":
      return error.detail;
  }
}

async function composeAndSend(kind: ContentKind, content: string, source: PromptSource): Promise<void> {
  const settings = await getSettings();
  const prompt = composePrompt(source, kind, content);
  const api = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
  const parts: TextPartInput[] = [{ type: "text", text: prompt }];

  if (settings.deliveryMode === "tui") {
    const append = await api.appendPromptTui(prompt);
    if (!append.ok) {
      notify("send-error", "Send to OpenCode failed", describeSendError(append.error));
      return;
    }
    if (settings.autoSubmitTui) {
      const submit = await api.submitPromptTui();
      if (!submit.ok) {
        notify("send-error", "TUI submit failed", describeSendError(submit.error));
        return;
      }
    }
    notify("send-ok", "Sent to OpenCode", "Prompt appended to the opencode TUI.");
    flashBadge();
    return;
  }

  const session = await api.createSession(source.title);
  if (!session.ok) {
    notify("send-error", "Send to OpenCode failed", describeSendError(session.error));
    return;
  }
  await addExtensionSessionId(session.value);
  const sent = await api.promptAsync(session.value, parts);
  if (!sent.ok) {
    notify("send-error", "Send to OpenCode failed", describeSendError(sent.error));
    return;
  }
  if (settings.autoOpenPanel) {
    await setPendingSessionId(session.value);
    // The panel was already opened synchronously in the gesture handler;
    // tell it (if it's open) to select the new session now.
    void chrome.runtime.sendMessage({ type: "select-session", sessionId: session.value }).catch(() => {});
  }
  notify("send-ok", "Sent to OpenCode", "Prompt sent to a new session.");
  flashBadge();
}

// Must stay synchronous: no await may precede chrome.sidePanel.open() or the
// user-gesture context is lost and the call rejects.
function openPanelIfConfigured(tab?: chrome.tabs.Tab): void {
  if (!cachedSettings.autoOpenPanel || tab?.windowId === undefined) {
    return;
  }
  try {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  } catch {
    // Ignore — gesture context unavailable.
  }
}

interface CapturedPage {
  title: string;
  url: string;
  text: string;
}

async function capturePageText(tabId: number, pageCharLimit: number): Promise<CapturedPage | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (limit: number) => {
        return {
          title: document.title,
          url: location.href,
          text: (document.body?.innerText ?? "").slice(0, limit),
        };
      },
      args: [pageCharLimit],
    });
    return results[0]?.result as CapturedPage | undefined;
  } catch {
    return undefined;
  }
}

async function readSelection(tabId: number): Promise<string | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? "",
    });
    const text = results[0]?.result;
    return typeof text === "string" && text.trim().length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function handleSelection(selection: string, tab?: chrome.tabs.Tab): Promise<void> {
  const url = tab?.url ?? "";
  const source: PromptSource = { title: tab?.title ?? "Selected text", url, issue: parseGithubIssue(url) };
  await composeAndSend("selection", selection, source);
}

async function handlePage(tab?: chrome.tabs.Tab): Promise<void> {
  if (tab?.id === undefined) {
    return;
  }
  const settings = await getSettings();
  const captured = await capturePageText(tab.id, settings.pageCharLimit);
  if (!captured) {
    notify("send-error", "Send to OpenCode failed", "Could not read the page content.");
    return;
  }
  const url = captured.url || tab.url || "";
  const source: PromptSource = { title: captured.title || tab.title || "Web page", url, issue: parseGithubIssue(url) };
  await composeAndSend("page", captured.text, source);
}

async function sendSelectionFromActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return;
  }
  const selection = await readSelection(tab.id);
  if (!selection) {
    notify("send-selection-empty", "Nothing selected", "Select text on the page first, then use Ctrl+Shift+U.");
    return;
  }
  await handleSelection(selection, tab);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SEND_SELECTION, title: "Send selection to OpenCode", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_SEND_PAGE, title: "Send page to OpenCode", contexts: ["page"] });
  });
  void checkHealth();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SEND_SELECTION && info.selectionText) {
    openPanelIfConfigured(tab);
    void handleSelection(info.selectionText, tab);
  } else if (info.menuItemId === MENU_SEND_PAGE) {
    openPanelIfConfigured(tab);
    void handlePage(tab);
  }
});

// Tracked so the keyboard-command handler can call sidePanel.open()
// synchronously (the shortcut gesture is even shorter-lived).
let activeWindowId: number | undefined;
chrome.tabs.onActivated.addListener((info) => {
  void chrome.tabs
    .get(info.tabId)
    .then((tab) => {
      activeWindowId = tab.windowId;
    })
    .catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== COMMAND_SEND_SELECTION) {
    return;
  }
  if (cachedSettings.autoOpenPanel && activeWindowId !== undefined) {
    try {
      void chrome.sidePanel.open({ windowId: activeWindowId }).catch(() => {});
    } catch {
      // Ignore — gesture context unavailable.
    }
  }
  void sendSelectionFromActiveTab();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as BackgroundMessage;
  if (msg?.type !== "check-connection") {
    return;
  }
  void (async () => {
    const api = createOpenCodeApi(msg.serverUrl, msg.serverPassword);
    const result = await api.health();
    const response: CheckConnectionResultMessage = { type: "check-connection-result", result };
    sendResponse(response);
  })();
  // Keep the message channel open for the async response.
  return true;
});

void checkHealth();
scheduleHealthCheck();
chrome.runtime.onStartup.addListener(() => {
  void checkHealth();
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      activeWindowId = tabs[0]?.windowId;
    })
    .catch(() => {});
});