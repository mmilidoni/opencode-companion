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

const settings = await getSettings();
serverUrlInput.value = settings.serverUrl;
serverPasswordInput.value = settings.serverPassword;
deliveryModeSelect.value = settings.deliveryMode;
autoOpenPanelCheckbox.checked = settings.autoOpenPanel;
autoSubmitTuiCheckbox.checked = settings.autoSubmitTui;
pageCharLimitInput.value = String(settings.pageCharLimit);

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
    });
    savedIndicator.hidden = false;
    setTimeout(() => {
      savedIndicator.hidden = true;
    }, 2000);
  })();
});