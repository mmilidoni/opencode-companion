export type DeliveryMode = "headless" | "tui" | "draft";

export interface Settings {
  serverUrl: string;
  serverPassword: string;
  deliveryMode: DeliveryMode;
  autoSubmitTui: boolean;
  pageCharLimit: number;
  autoOpenPanel: boolean;
  /** "" = server default agent. */
  agent: string;
  /** "" = server default provider. */
  modelProviderId: string;
  /** "" = server default model. */
  modelId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://localhost:4096",
  serverPassword: "",
  deliveryMode: "draft",
  autoSubmitTui: false,
  pageCharLimit: 20_000,
  autoOpenPanel: true,
  agent: "",
  modelProviderId: "",
  modelId: "",
};

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

const EXTENSION_SESSION_IDS_KEY = "extensionSessionIds";
const MAX_RECORDED_SESSION_IDS = 1_000;

export async function getExtensionSessionIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(EXTENSION_SESSION_IDS_KEY);
  const ids = stored[EXTENSION_SESSION_IDS_KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function addExtensionSessionId(id: string): Promise<void> {
  const ids = await getExtensionSessionIds();
  if (ids.includes(id)) {
    return;
  }
  ids.push(id);
  const capped = ids.length > MAX_RECORDED_SESSION_IDS ? ids.slice(-MAX_RECORDED_SESSION_IDS) : ids;
  await chrome.storage.local.set({ [EXTENSION_SESSION_IDS_KEY]: capped });
}

export async function removeExtensionSessionIds(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const toRemove = new Set(ids);
  const remaining = (await getExtensionSessionIds()).filter((id) => !toRemove.has(id));
  await chrome.storage.local.set({ [EXTENSION_SESSION_IDS_KEY]: remaining });
}

const PENDING_SESSION_ID_KEY = "pendingSessionId";

export async function getPendingSessionId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(PENDING_SESSION_ID_KEY);
  const id = stored[PENDING_SESSION_ID_KEY];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function setPendingSessionId(id: string): Promise<void> {
  await chrome.storage.local.set({ [PENDING_SESSION_ID_KEY]: id });
}

export async function clearPendingSessionId(): Promise<void> {
  await chrome.storage.local.remove(PENDING_SESSION_ID_KEY);
}

export interface PendingDraft {
  /** Session the capture belongs to — the draft is discarded when the user switches away from it. */
  sessionId: string;
  /** Full composed prompt (delimiters + guard note) that will be sent. */
  prompt: string;
  /** Raw captured content, single-line, truncated for the composer preview strip. */
  preview: string;
  /** Short label shown next to the preview, e.g. "Selected text" / "Page". */
  label: string;
}

const PENDING_DRAFT_KEY = "pendingDraft";

export async function setPendingDraft(draft: PendingDraft): Promise<void> {
  await chrome.storage.local.set({ [PENDING_DRAFT_KEY]: draft });
}

export async function getPendingDraft(): Promise<PendingDraft | null> {
  const stored = await chrome.storage.local.get(PENDING_DRAFT_KEY);
  const draft = stored[PENDING_DRAFT_KEY] as PendingDraft | undefined;
  return draft && typeof draft.sessionId === "string" && typeof draft.prompt === "string" && draft.prompt.length > 0
    ? draft
    : null;
}

export async function clearPendingDraft(): Promise<void> {
  await chrome.storage.local.remove(PENDING_DRAFT_KEY);
}