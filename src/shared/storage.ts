export type DeliveryMode = "headless" | "tui";

export interface Settings {
  serverUrl: string;
  serverPassword: string;
  deliveryMode: DeliveryMode;
  autoSubmitTui: boolean;
  pageCharLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://localhost:4096",
  serverPassword: "",
  deliveryMode: "headless",
  autoSubmitTui: false,
  pageCharLimit: 20_000,
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