import { createOpenCodeApi } from "../shared/opencode.js";
import type { MessageThreadEntry, OpenCodeApi, OpenCodeError } from "../shared/opencode.js";
import { getSettings, saveSettings, addExtensionSessionId, removeExtensionSessionIds, getExtensionSessionIds, getPendingSessionId, clearPendingSessionId } from "../shared/storage.js";
import type { Settings } from "../shared/storage.js";
import type { TextPart } from "@opencode-ai/sdk/client";
import type { Command } from "@opencode-ai/sdk/client";
import DOMPurify from "dompurify";
import { marked } from "marked";

const HEALTH_POLL_MS = 5_000;
const PENDING_POLL_MS = 1_500;

interface StreamEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

const connDot = document.getElementById("conn-dot") as HTMLSpanElement;
const connText = document.getElementById("conn-text") as HTMLSpanElement;
const sessionSelect = document.getElementById("session-select") as HTMLSelectElement;
const threadEl = document.getElementById("thread") as HTMLElement;
const emptyEl = document.getElementById("thread-empty") as HTMLDivElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const promptEl = document.getElementById("prompt") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const deleteSessionBtn = document.getElementById("delete-session") as HTMLButtonElement;
const deleteAllBtn = document.getElementById("delete-all") as HTMLButtonElement;
const commandSelect = document.getElementById("command-select") as HTMLSelectElement;
const commandArgs = document.getElementById("command-args") as HTMLInputElement;
const runCommandBtn = document.getElementById("run-command") as HTMLButtonElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;

let settings: Settings = await getSettings();
let api: OpenCodeApi = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
let connected = false;
let selectedSessionId: string | null = null;
let thread: MessageThreadEntry[] = [];
let commands: Command[] = [];
let commandsFetchedFromUrl = "";
let visibleSessionCount = 0;
const messageEls = new Map<string, HTMLDivElement>();
const partEls = new Map<string, HTMLElement>();

function describeError(error: OpenCodeError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Authentication failed — check the server password in settings.";
    case "unreachable":
      return "Could not reach the opencode server — is it running?";
    case "server":
      return `Server error (${error.status}).`;
    case "tui":
      return error.detail;
  }
}

function scrollToBottom(): void {
  threadEl.scrollTop = threadEl.scrollHeight;
}

function setConnected(ok: boolean): void {
  connected = ok;
  connDot.dataset.state = ok ? "ok" : "error";
  connText.textContent = ok ? "Connected" : "Disconnected";
  updateControls();
}

function updateControls(): void {
  sendBtn.disabled = !connected || selectedSessionId === null;
  abortBtn.disabled = selectedSessionId === null;
  deleteSessionBtn.disabled = !connected || selectedSessionId === null;
  deleteAllBtn.disabled = !connected || visibleSessionCount === 0;
  commandSelect.disabled = !connected || selectedSessionId === null || commands.length === 0;
  runCommandBtn.disabled = !connected || selectedSessionId === null || commandSelect.value === "";
}

async function refreshCommands(): Promise<void> {
  const result = await api.listCommands();
  if (!result.ok) {
    commandSelect.textContent = "";
    return;
  }
  commands = result.value;
  const selected = commandSelect.value;
  commandSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = commands.length === 0 ? "No commands available" : "Commands…";
  placeholder.disabled = true;
  commandSelect.appendChild(placeholder);
  for (const cmd of commands) {
    const option = document.createElement("option");
    option.value = cmd.name;
    option.textContent = `/${cmd.name}${cmd.description ? ` — ${cmd.description}` : ""}`;
    option.title = cmd.template;
    commandSelect.appendChild(option);
  }
  commandSelect.value = selected;
  updateControls();
}

async function runSelectedCommand(): Promise<void> {
  if (selectedSessionId === null || !connected) {
    return;
  }
  const command = commandSelect.value;
  if (!command) {
    return;
  }
  const args = commandArgs.value.trim();
  const result = await api.runCommand(selectedSessionId, command, args);
  if (!result.ok) {
    const err = document.createElement("div");
    err.className = "send-error";
    err.textContent = describeError(result.error);
    messagesEl.appendChild(err);
    scrollToBottom();
    return;
  }
  commandArgs.value = "";
  await reloadThread();
}

async function refreshModels(): Promise<void> {
  const providerId = settings.modelProviderId;
  if (!providerId) {
    modelSelect.disabled = true;
    modelSelect.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Set a provider in Options";
    placeholder.disabled = true;
    modelSelect.appendChild(placeholder);
    modelSelect.value = "";
    return;
  }
  modelSelect.disabled = false;
  // Seed the saved selection so it renders before/without a server response.
  modelSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Server default";
  modelSelect.appendChild(placeholder);
  if (settings.modelId) {
    const seeded = document.createElement("option");
    seeded.value = settings.modelId;
    seeded.textContent = settings.modelId;
    modelSelect.appendChild(seeded);
  }
  const result = await api.listProviders();
  if (result.ok) {
    const provider = result.value.providers.find((p) => p.id === providerId);
    const modelIds = Object.keys(provider?.models ?? {});
    if (modelIds.length > 0) {
      modelSelect.textContent = "";
      const livePlaceholder = document.createElement("option");
      livePlaceholder.value = "";
      livePlaceholder.textContent = "Server default";
      modelSelect.appendChild(livePlaceholder);
      for (const modelId of modelIds) {
        const option = document.createElement("option");
        option.value = modelId;
        option.textContent = modelId;
        modelSelect.appendChild(option);
      }
    }
  }
  modelSelect.value = settings.modelId;
}

async function pollHealth(): Promise<void> {
  const result = await api.health();
  const wasConnected = connected;
  setConnected(result.ok);
  if (result.ok && (!wasConnected || commandsFetchedFromUrl !== settings.serverUrl)) {
    await refreshSessions();
    await refreshCommands();
    commandsFetchedFromUrl = settings.serverUrl;
  }
}

async function refreshSessions(): Promise<void> {
  const result = await api.listSessions();
  if (!result.ok) {
    setConnected(false);
    return;
  }
  sessionSelect.textContent = "";
  const extensionIds = new Set(await getExtensionSessionIds());
  const sorted = [...result.value]
    .filter((session) => extensionIds.has(session.id))
    .sort((a, b) => b.time.updated - a.time.updated);
  visibleSessionCount = sorted.length;
  if (sorted.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No sessions from this browser yet — right-click a page to send";
    placeholder.disabled = true;
    sessionSelect.appendChild(placeholder);
    sessionSelect.value = "";
    updateControls();
    return;
  }
  for (const session of sorted) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.title || "Untitled";
    option.title = session.id;
    option.selected = session.id === selectedSessionId;
    sessionSelect.appendChild(option);
  }
  sessionSelect.value = selectedSessionId ?? "";
  updateControls();
}

async function selectSession(id: string): Promise<void> {
  selectedSessionId = id;
  sessionSelect.value = id;
  messageEls.clear();
  partEls.clear();
  updateControls();
  const result = await api.listMessages(id);
  if (!result.ok) {
    setConnected(false);
    return;
  }
  thread = result.value;
  renderThread();
}

async function createNewSession(): Promise<void> {
  const result = await api.createSession("New session");
  if (!result.ok) {
    setConnected(false);
    return;
  }
  await addExtensionSessionId(result.value);
  await refreshSessions();
  await selectSession(result.value);
}

function clearSelectedSession(): void {
  selectedSessionId = null;
  thread = [];
  messageEls.clear();
  partEls.clear();
  renderThread();
  updateControls();
}

function appendError(message: string): void {
  const err = document.createElement("div");
  err.className = "send-error";
  err.textContent = message;
  messagesEl.appendChild(err);
  scrollToBottom();
}

async function deleteCurrentSession(): Promise<void> {
  if (selectedSessionId === null || !connected) {
    return;
  }
  const id = selectedSessionId;
  const title = sessionSelect.selectedOptions[0]?.textContent ?? "this session";
  if (!confirm(`Delete session "${title}"? This cannot be undone.`)) {
    return;
  }
  const result = await api.deleteSession(id);
  if (!result.ok) {
    appendError(describeError(result.error));
    return;
  }
  await removeExtensionSessionIds([id]);
  const pending = await getPendingSessionId();
  if (pending === id) {
    await clearPendingSessionId();
  }
  clearSelectedSession();
  await refreshSessions();
}

async function deleteAllSessions(): Promise<void> {
  if (!connected) {
    return;
  }
  const ids = await getExtensionSessionIds();
  if (ids.length === 0) {
    return;
  }
  if (!confirm(`Delete all ${ids.length} sessions created by this extension? This cannot be undone.`)) {
    return;
  }
  const results = await Promise.allSettled(ids.map((id) => api.deleteSession(id)));
  const failed = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
  ).length;
  await removeExtensionSessionIds(ids);
  await clearPendingSessionId();
  clearSelectedSession();
  await refreshSessions();
  if (failed > 0) {
    appendError(`Deleted ${ids.length - failed} of ${ids.length} sessions.`);
  }
}

function renderThread(): void {
  messagesEl.textContent = "";
  messageEls.clear();
  partEls.clear();
  if (selectedSessionId === null || thread.length === 0) {
    emptyEl.hidden = false;
    messagesEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  messagesEl.hidden = false;
  for (const entry of thread) {
    messagesEl.appendChild(renderMessageEntry(entry));
  }
  scrollToBottom();
}

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}

function renderMessageEntry(entry: MessageThreadEntry): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${entry.info.role}`;

  const label = document.createElement("div");
  label.className = "role";
  label.textContent = entry.info.role === "user" ? "You" : "opencode";

  const body = document.createElement("div");
  body.className = "body";
  const isAssistant = entry.info.role === "assistant";
  for (const part of entry.parts) {
    if (part.type === "text" && !part.ignored) {
      const el = document.createElement(isAssistant ? "div" : "p");
      el.className = isAssistant ? "part-text part-markdown" : "part-text";
      if (isAssistant) {
        el.innerHTML = renderMarkdown(part.text);
      } else {
        el.textContent = part.text;
      }
      body.appendChild(el);
      partEls.set(`${part.messageID}:${part.id}`, el);
    }
  }

  bubble.append(label, body);
  messageEls.set(entry.info.id, bubble);
  return bubble;
}

function handleStreamEvent(raw: unknown): void {
  const ev = raw as StreamEvent;
  switch (ev.type) {
    case "session.created":
    case "session.deleted":
      void refreshSessions();
      break;
    case "message.part.updated": {
      const part = ev.properties?.part as Partial<TextPart> | undefined;
      if (part && part.sessionID === selectedSessionId && part.type === "text" && part.messageID && part.id) {
        updateStreamedPart(part as TextPart);
      }
      break;
    }
  }
}

function updateStreamedPart(part: TextPart): void {
  if (messagesEl.hidden) {
    emptyEl.hidden = true;
    messagesEl.hidden = false;
  }
  let bubble = messageEls.get(part.messageID);
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.className = "bubble assistant";

    const label = document.createElement("div");
    label.className = "role";
    label.textContent = "opencode";

    const body = document.createElement("div");
    body.className = "body";

    bubble.append(label, body);
    messagesEl.appendChild(bubble);
    messageEls.set(part.messageID, bubble);
  }
  const body = bubble.querySelector<HTMLDivElement>(".body");
  if (!body) {
    return;
  }
  const key = `${part.messageID}:${part.id}`;
  let el = partEls.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "part-text part-markdown";
    body.appendChild(el);
    partEls.set(key, el);
  }
  el.innerHTML = renderMarkdown(part.text);
  scrollToBottom();
}

async function sendPrompt(): Promise<void> {
  const text = promptEl.value.trim();
  if (!text || selectedSessionId === null || !connected) {
    return;
  }
  promptEl.value = "";
  const model =
    settings.modelProviderId && settings.modelId
      ? { providerID: settings.modelProviderId, modelID: settings.modelId }
      : undefined;
  const result = await api.promptAsync(selectedSessionId, [{ type: "text", text }], {
    agent: settings.agent || undefined,
    model,
  });
  if (!result.ok) {
    const err = document.createElement("div");
    err.className = "send-error";
    err.textContent = describeError(result.error);
    messagesEl.appendChild(err);
    scrollToBottom();
    return;
  }
  // Reload so the user's message appears; the assistant response streams via SSE.
  await reloadThread();
}

async function reloadThread(): Promise<void> {
  if (selectedSessionId === null) {
    return;
  }
  const result = await api.listMessages(selectedSessionId);
  if (!result.ok) {
    setConnected(false);
    return;
  }
  thread = result.value;
  renderThread();
}

async function subscribeToEvents(): Promise<void> {
  const stream = await api.eventSubscribe();
  for await (const raw of stream) {
    handleStreamEvent(raw);
  }
}

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendPrompt();
  }
});
sendBtn.addEventListener("click", () => {
  void sendPrompt();
});
abortBtn.addEventListener("click", () => {
  if (selectedSessionId !== null) {
    void api.abort(selectedSessionId);
  }
});
newSessionBtn.addEventListener("click", () => {
  void createNewSession();
});

deleteSessionBtn.addEventListener("click", () => {
  void deleteCurrentSession();
});

deleteAllBtn.addEventListener("click", () => {
  void deleteAllSessions();
});

commandSelect.addEventListener("change", () => {
  updateControls();
});

modelSelect.addEventListener("change", () => {
  settings.modelId = modelSelect.value;
  void saveSettings(settings);
});

runCommandBtn.addEventListener("click", () => {
  void runSelectedCommand();
});

sessionSelect.addEventListener("change", () => {
  const id = sessionSelect.value;
  if (id) {
    void selectSession(id);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    const previousProviderId = settings.modelProviderId;
    settings = { ...settings, ...(changes.settings.newValue as Settings) };
    api = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
    if (settings.modelProviderId !== previousProviderId) {
      void refreshModels();
    } else {
      modelSelect.value = settings.modelId;
    }
    void pollHealth();
  }
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type?: string; sessionId?: string };
  if (msg.type === "select-session" && msg.sessionId) {
    void selectSession(msg.sessionId);
    void clearPendingSessionId();
  }
});

async function consumePendingSession(): Promise<void> {
  const pending = await getPendingSessionId();
  if (!pending) {
    return;
  }
  await clearPendingSessionId();
  await refreshSessions();
  await selectSession(pending);
}

void (async () => {
  void refreshModels();
  await pollHealth();
  await refreshSessions();
  await consumePendingSession();
  void subscribeToEvents();
})();
setInterval(() => {
  void pollHealth();
}, HEALTH_POLL_MS);
setInterval(() => {
  void consumePendingSession();
}, PENDING_POLL_MS);