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