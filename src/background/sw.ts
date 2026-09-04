const SERVER_URL = "http://localhost:4096";
const HEALTH_CHECK_INTERVAL_MS = 30_000;

type Health = { healthy: boolean; version: string };

function setBadge(state: "ok" | "error" | "unknown"): void {
  const color = state === "ok" ? "#22c55e" : state === "error" ? "#ef4444" : "#6b7280";
  const text = state === "ok" ? "OK" : state === "error" ? "ERR" : "…";
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
}

async function checkHealth(): Promise<void> {
  try {
    const res = await fetch(`${SERVER_URL}/global/health`);
    if (!res.ok) {
      throw new Error(`health check failed with ${res.status}`);
    }
    const health = (await res.json()) as Health;
    setBadge(health.healthy ? "ok" : "error");
  } catch {
    setBadge("error");
  }
}

function scheduleHealthCheck(): void {
  setTimeout(() => {
    void checkHealth();
    scheduleHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
}

void checkHealth();
scheduleHealthCheck();
chrome.runtime.onInstalled.addListener(() => {
  void checkHealth();
});
chrome.runtime.onStartup.addListener(() => {
  void checkHealth();
});