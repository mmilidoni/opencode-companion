import { createOpenCodeApi } from "../shared/opencode.js";
import type { OpenCodeError } from "../shared/opencode.js";
import { getSettings, saveSettings } from "../shared/storage.js";
import type { DeliveryMode } from "../shared/storage.js";

const form = document.getElementById("options-form") as HTMLFormElement;
const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const serverPasswordInput = document.getElementById("server-password") as HTMLInputElement;
const deliveryModeSelect = document.getElementById("delivery-mode") as HTMLSelectElement;
const autoOpenPanelCheckbox = document.getElementById("auto-open-panel") as HTMLInputElement;
const autoSubmitTuiCheckbox = document.getElementById("auto-submit-tui") as HTMLInputElement;
const pageCharLimitInput = document.getElementById("page-char-limit") as HTMLInputElement;
const savedIndicator = document.getElementById("saved") as HTMLSpanElement;
const agentSelect = document.getElementById("agent-select") as HTMLSelectElement;
const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const loadBtn = document.getElementById("load-options") as HTMLButtonElement;
const optionsStatus = document.getElementById("options-status") as HTMLSpanElement;

interface ProviderOption {
  id: string;
  name: string;
  models: Record<string, unknown>;
}

let providers: ProviderOption[] = [];

const settings = await getSettings();
serverUrlInput.value = settings.serverUrl;
serverPasswordInput.value = settings.serverPassword;
deliveryModeSelect.value = settings.deliveryMode;
autoOpenPanelCheckbox.checked = settings.autoOpenPanel;
autoSubmitTuiCheckbox.checked = settings.autoSubmitTui;
pageCharLimitInput.value = String(settings.pageCharLimit);

// Seed saved selections as options so the selects render them before the
// server list is loaded; "Load from server" replaces them with real entries.
if (settings.agent) {
  const option = document.createElement("option");
  option.value = settings.agent;
  option.textContent = settings.agent;
  agentSelect.appendChild(option);
}
agentSelect.value = settings.agent;
if (settings.modelProviderId) {
  const option = document.createElement("option");
  option.value = settings.modelProviderId;
  option.textContent = settings.modelProviderId;
  providerSelect.appendChild(option);
}
providerSelect.value = settings.modelProviderId;
if (settings.modelId) {
  const option = document.createElement("option");
  option.value = settings.modelId;
  option.textContent = settings.modelId;
  modelSelect.appendChild(option);
}
modelSelect.value = settings.modelId;

function describeError(error: OpenCodeError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Authentication failed — check the server password.";
    case "unreachable":
      return "Could not reach the server. Is `opencode serve` running?";
    case "server":
      return `Server error (${error.status}).`;
    case "tui":
      return error.detail;
  }
}

function setOptionsStatus(text: string, isError: boolean): void {
  optionsStatus.textContent = text;
  optionsStatus.dataset.state = isError ? "error" : "ok";
}

function populateAgents(agents: { name: string; description?: string }[]): void {
  const selected = agentSelect.value;
  agentSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Server default";
  agentSelect.appendChild(placeholder);
  for (const agent of agents) {
    const option = document.createElement("option");
    option.value = agent.name;
    option.textContent = agent.name;
    option.title = agent.description ?? "";
    agentSelect.appendChild(option);
  }
  agentSelect.value = selected;
}

function populateModels(selectedModel: string): void {
  const provider = providers.find((p) => p.id === providerSelect.value);
  modelSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Server default";
  modelSelect.appendChild(placeholder);
  for (const modelId of Object.keys(provider?.models ?? {})) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    modelSelect.appendChild(option);
  }
  modelSelect.value = selectedModel;
}

function populateProviders(): void {
  const selectedProvider = providerSelect.value;
  const selectedModel = modelSelect.value;
  providerSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Server default";
  providerSelect.appendChild(placeholder);
  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name || provider.id;
    providerSelect.appendChild(option);
  }
  providerSelect.value = selectedProvider;
  populateModels(selectedModel);
}

async function loadFromServer(silent: boolean): Promise<void> {
  const serverUrl = serverUrlInput.value.trim();
  const serverPassword = serverPasswordInput.value;
  if (!serverUrl) {
    if (!silent) {
      setOptionsStatus("Enter a server URL first.", true);
    }
    return;
  }
  const api = createOpenCodeApi(serverUrl, serverPassword);
  const [agentsResult, providersResult] = await Promise.all([api.listAgents(), api.listProviders()]);
  if (!agentsResult.ok) {
    if (!silent) {
      setOptionsStatus(describeError(agentsResult.error), true);
    }
    return;
  }
  if (!providersResult.ok) {
    if (!silent) {
      setOptionsStatus(describeError(providersResult.error), true);
    }
    return;
  }
  providers = providersResult.value.providers;
  populateAgents(agentsResult.value);
  populateProviders();
  if (!silent) {
    setOptionsStatus(`Loaded ${agentsResult.value.length} agents, ${providers.length} providers.`, false);
  }
}

providerSelect.addEventListener("change", () => {
  populateModels(modelSelect.value);
});

loadBtn.addEventListener("click", () => {
  void loadFromServer(false);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const pageCharLimit = Number.parseInt(pageCharLimitInput.value, 10);
  if (!Number.isFinite(pageCharLimit) || pageCharLimit < 1000) {
    pageCharLimitInput.setCustomValidity("Must be at least 1000 characters.");
    pageCharLimitInput.reportValidity();
    return;
  }
  pageCharLimitInput.setCustomValidity("");
  void (async () => {
    await saveSettings({
      serverUrl: serverUrlInput.value.trim(),
      serverPassword: serverPasswordInput.value,
      deliveryMode: deliveryModeSelect.value as DeliveryMode,
      autoOpenPanel: autoOpenPanelCheckbox.checked,
      autoSubmitTui: autoSubmitTuiCheckbox.checked,
      pageCharLimit,
      agent: agentSelect.value,
      modelProviderId: providerSelect.value,
      modelId: modelSelect.value,
    });
    savedIndicator.hidden = false;
    setTimeout(() => {
      savedIndicator.hidden = true;
    }, 2000);
  })();
});

// Try to seed the pickers silently on open so saved values resolve against
// the live server without requiring a click.
void loadFromServer(true);