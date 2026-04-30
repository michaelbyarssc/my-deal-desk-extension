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

// Allowed origins for the pair-from-page handshake. The content script
// can only run on these matches per manifest, but we double-check origin
// here so a compromised content script can't store an arbitrary token.
const ALLOWED_PAIR_ORIGINS = new Set([
  // Lovable preview URLs
  "https://my-deal-desk.lovable.app",
  // Custom domain (when configured)
  "https://my-deal-desk.com",
  "https://app.my-deal-desk.com",
]);

const isAllowedPairOrigin = (origin: string | undefined): boolean => {
  if (!origin) return false;
  if (ALLOWED_PAIR_ORIGINS.has(origin)) return true;
  // Allow any *.lovable.app subdomain for preview deploys.
  try {
    const u = new URL(origin);
    return u.hostname.endsWith(".lovable.app");
  } catch {
    return false;
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Pair token forwarded from the agentpath app via pair-receiver content
  // script. Stores it in chrome.storage.local exactly like the manual
  // paste flow used to.
  if (msg?.type === "pair-from-page") {
    const senderOrigin = sender.origin ?? msg?.origin;
    if (!isAllowedPairOrigin(senderOrigin)) {
      sendResponse({ ok: false, error: `origin not allowed: ${senderOrigin}` });
      return false;
    }
    const token = typeof msg.token === "string" ? msg.token : "";
    const email = typeof msg.email === "string" ? msg.email : "";
    if (!token || !email) {
      sendResponse({ ok: false, error: "missing token or email" });
      return false;
    }
    void chrome.storage.local
      .set({ "mdd.pairingToken": token, "mdd.agentEmail": email })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
    return true; // async response
  }

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
