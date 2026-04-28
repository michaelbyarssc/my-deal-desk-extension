// Background service worker.
//
// Holds the most recent "fillable" report from each tab so the popup can
// render correctly even if the tab fired its message before the popup
// opened. Routes messages between popup and content script.

interface FillableState {
  target: string;
  label: string;
  formTemplateId: string | null;
  pageUrl: string;
  reportedAt: number;
}

const tabFillableState = new Map<number, FillableState>();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script reporting that the page is ready to fill.
  if (msg?.type === "fillable" && sender.tab?.id != null) {
    tabFillableState.set(sender.tab.id, {
      ...(msg.payload as Omit<FillableState, "reportedAt">),
      reportedAt: Date.now(),
    });
    return false;
  }

  // Popup asking what's currently fillable in the active tab.
  if (msg?.type === "popup-get-state") {
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: true, fillable: null, tab: null });
        return;
      }
      const state = tabFillableState.get(tab.id);
      // If we don't have state yet, ask the content script directly. This
      // covers the case where the popup opens before fillable fires.
      if (!state) {
        chrome.tabs
          .sendMessage(tab.id, { type: "ping-content" })
          .then(() => {
            sendResponse({
              ok: true,
              fillable: tabFillableState.get(tab.id!) ?? null,
              tab: { id: tab.id, url: tab.url ?? null },
            });
          })
          .catch(() => {
            sendResponse({
              ok: true,
              fillable: null,
              tab: { id: tab.id, url: tab.url ?? null },
            });
          });
        return;
      }
      sendResponse({
        ok: true,
        fillable: state,
        tab: { id: tab.id, url: tab.url ?? null },
      });
    });
    return true; // async response
  }

  // Popup forwarding a fill request to the content script of the active tab.
  if (msg?.type === "popup-trigger-fill") {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "request-fill",
          intake: msg.intake,
          fieldMap: msg.fieldMap,
        });
        sendResponse(response);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        sendResponse({ ok: false, error: errMsg });
      }
    });
    return true;
  }

  return false;
});

// Cleanup state when tabs close.
chrome.tabs.onRemoved.addListener((tabId) => {
  tabFillableState.delete(tabId);
});

// Cleanup on navigation away from a fillable URL.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) {
    // The content script will re-fire fillable if the new URL matches.
    // Drop stale state in the meantime.
    tabFillableState.delete(tabId);
  }
});
