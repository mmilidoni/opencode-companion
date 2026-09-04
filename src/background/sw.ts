import { createOpenCodeApi } from "../shared/opencode.js";
import { getSettings } from "../shared/storage.js";
import type { BackgroundMessage, CheckConnectionResultMessage } from "../shared/types.js";

const HEALTH_CHECK_INTERVAL_MS = 30_000;

function setBadge(state: "ok" | "error" | "unknown"): void {
  const color = state === "ok" ? "#22c55e" : state === "error" ? "#ef4444" : "#6b7280";
  const text = state === "ok" ? "OK" : state === "error" ? "ERR" : "…";
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
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
chrome.runtime.onInstalled.addListener(() => {
  void checkHealth();
});
chrome.runtime.onStartup.addListener(() => {
  void checkHealth();
});