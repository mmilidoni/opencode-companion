// Platform shim for the handful of APIs that differ between Chrome and
// Firefox. Chrome exposes `chrome.sidePanel`; Firefox has no side-panel API
// and instead exposes `browser.sidebarAction`. Both are resolved here so the
// rest of the codebase calls a single `openPanel()`.
//
// `__PLATFORM__` is a compile-time constant injected by esbuild (see
// esbuild.config.mjs) so the other platform's branch is dead-code-eliminated
// from each bundle — the Firefox build never references `chrome.sidePanel`.

declare const __PLATFORM__: "chrome" | "firefox";

interface FirefoxSidebarNamespace {
  sidebarAction: { open(): Promise<void> };
}

export const isFirefox: boolean = __PLATFORM__ === "firefox";

/**
 * Open the chat surface. Chrome's `chrome.sidePanel.open()` needs the target
 * window id; Firefox's `browser.sidebarAction.open()` opens in the active
 * window and takes no id. Must be invoked synchronously within a user gesture
 * in both browsers — callers must not await anything before calling this.
 */
export function openPanel(windowId?: number): Promise<void> {
  if (__PLATFORM__ === "firefox") {
    const browser = (globalThis as unknown as { browser?: FirefoxSidebarNamespace }).browser;
    if (!browser) {
      return Promise.resolve();
    }
    return browser.sidebarAction.open();
  } else {
    if (windowId === undefined) {
      return Promise.resolve();
    }
    return chrome.sidePanel.open({ windowId });
  }
}