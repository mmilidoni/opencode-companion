import { getSettings, saveSettings } from "../shared/storage.js";
import type { DeliveryMode } from "../shared/storage.js";
import type { ConnectionResult, OpenCodeError } from "../shared/opencode.js";
import type { BackgroundMessage } from "../shared/types.js";

const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const statusDetail = document.getElementById("status-detail") as HTMLParagraphElement;
const form = document.getElementById("settings-form") as HTMLFormElement;
const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const serverPasswordInput = document.getElementById("server-password") as HTMLInputElement;
const deliveryModeSelect = document.getElementById("delivery-mode") as HTMLSelectElement;
const testButton = document.getElementById("test-connection") as HTMLButtonElement;
const openPanelButton = document.getElementById("open-panel") as HTMLButtonElement;

const savedSettings = await getSettings();
serverUrlInput.value = savedSettings.serverUrl;
serverPasswordInput.value = savedSettings.serverPassword;
deliveryModeSelect.value = savedSettings.deliveryMode;

function renderResult(result: ConnectionResult): void {
  statusDot.dataset.state = result.ok ? "ok" : "error";
  if (result.ok) {
    statusText.textContent = `Connected — opencode ${result.value.version}`;
    if (!result.value.requiresAuth && result.value.passwordProvided) {
      statusDetail.hidden = false;
      statusDetail.dataset.state = "ok";
      statusDetail.textContent = "This server doesn't require a password — you can remove it from settings.";
    } else {
      statusDetail.hidden = true;
    }
    return;
  }
  statusText.textContent = "Disconnected";
  statusDetail.hidden = false;
  statusDetail.dataset.state = "error";
  statusDetail.textContent = describeError(result.error);
}

function describeError(error: OpenCodeError): string {
  switch (error.kind) {
    case "unauthorized":
      return error.passwordProvided
        ? "Authentication failed — check the server password."
        : "The server requires a password — enter it in settings.";
    case "unreachable":
      return `Could not reach the server. Is \`opencode serve\` running on ${serverUrlInput.value}?`;
    case "server":
      return `Server error (${error.status}).`;
    case "tui":
      return error.detail;
  }
}

async function runConnectionCheck(serverUrl: string, serverPassword: string): Promise<void> {
  statusDot.dataset.state = "unknown";
  statusText.textContent = "Checking…";
  statusDetail.hidden = true;
  const message: BackgroundMessage = { type: "check-connection", serverUrl, serverPassword };
  const response = (await chrome.runtime.sendMessage(message)) as { result: ConnectionResult } | undefined;
  renderResult(response?.result ?? { ok: false, error: { kind: "unreachable", detail: "no response from extension" } });
}

testButton.addEventListener("click", () => {
  void runConnectionCheck(serverUrlInput.value.trim(), serverPasswordInput.value);
});

openPanelButton.addEventListener("click", () => {
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  })();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) {
    return;
  }
  const serverPassword = serverPasswordInput.value;
  const deliveryMode = deliveryModeSelect.value as DeliveryMode;
  void (async () => {
    await saveSettings({ ...savedSettings, serverUrl, serverPassword, deliveryMode });
    await runConnectionCheck(serverUrl, serverPassword);
  })();
});

void runConnectionCheck(savedSettings.serverUrl, savedSettings.serverPassword);