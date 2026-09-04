import { createOpenCodeApi } from "../shared/opencode.js";
import type { MessageThreadEntry, OpenCodeApi, OpenCodeError } from "../shared/opencode.js";
import { getSettings, addExtensionSessionId, getExtensionSessionIds } from "../shared/storage.js";
import type { Settings } from "../shared/storage.js";
import type { Session, TextPart } from "@opencode-ai/sdk/client";

const HEALTH_POLL_MS = 5_000;

interface StreamEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

const connDot = document.getElementById("conn-dot") as HTMLSpanElement;
const connText = document.getElementById("conn-text") as HTMLSpanElement;
const sessionsEl = document.getElementById("sessions") as HTMLDivElement;
const threadEl = document.getElementById("thread") as HTMLElement;
const emptyEl = document.getElementById("thread-empty") as HTMLDivElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const promptEl = document.getElementById("prompt") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;

let settings: Settings = await getSettings();
let api: OpenCodeApi = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
let connected = false;
let selectedSessionId: string | null = null;
let thread: MessageThreadEntry[] = [];
const messageEls = new Map<string, HTMLDivElement>();
const partEls = new Map<string, HTMLParagraphElement>();

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
}

async function pollHealth(): Promise<void> {
  const result = await api.health();
  const wasConnected = connected;
  setConnected(result.ok);
  if (result.ok && !wasConnected) {
    await refreshSessions();
  }
}

async function refreshSessions(): Promise<void> {
  const result = await api.listSessions();
  if (!result.ok) {
    setConnected(false);
    return;
  }
  sessionsEl.textContent = "";
  const extensionIds = new Set(await getExtensionSessionIds());
  const sorted = [...result.value]
    .filter((session) => extensionIds.has(session.id))
    .sort((a, b) => b.time.updated - a.time.updated);
  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sessions-empty";
    empty.textContent = "No sessions from this browser yet. Right-click a page and pick \"Send selection to OpenCode\".";
    sessionsEl.appendChild(empty);
    return;
  }
  for (const session of sorted) {
    sessionsEl.appendChild(renderSessionChip(session));
  }
}

function renderSessionChip(session: Session): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.className = "session-chip";
  chip.classList.toggle("active", session.id === selectedSessionId);
  chip.title = session.id;
  chip.textContent = session.title || "Untitled";
  chip.addEventListener("click", () => {
    void selectSession(session.id);
  });
  return chip;
}

async function selectSession(id: string): Promise<void> {
  selectedSessionId = id;
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

function renderMessageEntry(entry: MessageThreadEntry): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${entry.info.role}`;

  const label = document.createElement("div");
  label.className = "role";
  label.textContent = entry.info.role === "user" ? "You" : "opencode";

  const body = document.createElement("div");
  body.className = "body";
  for (const part of entry.parts) {
    if (part.type === "text" && !part.ignored) {
      const p = document.createElement("p");
      p.className = "part-text";
      p.textContent = part.text;
      body.appendChild(p);
      partEls.set(`${part.messageID}:${part.id}`, p);
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
    el = document.createElement("p");
    el.className = "part-text";
    body.appendChild(el);
    partEls.set(key, el);
  }
  el.textContent = part.text;
  scrollToBottom();
}

async function sendPrompt(): Promise<void> {
  const text = promptEl.value.trim();
  if (!text || selectedSessionId === null || !connected) {
    return;
  }
  promptEl.value = "";
  const result = await api.promptAsync(selectedSessionId, [{ type: "text", text }]);
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    settings = { ...settings, ...(changes.settings.newValue as Settings) };
    api = createOpenCodeApi(settings.serverUrl, settings.serverPassword);
    void pollHealth();
  }
});

void pollHealth();
void refreshSessions();
void subscribeToEvents();
setInterval(() => {
  void pollHealth();
}, HEALTH_POLL_MS);