// Pair-receiver content script. Runs on the agentpath / My Deal Desk app
// domain. Listens for window.postMessage events from the page's
// /connect-browser flow, forwards the pairing token to the background
// service worker for storage, and posts a success message back to the page.
//
// This avoids the older copy/paste-token UX entirely: the agent clicks
// "Connect this browser" inside the app, and the extension auto-stores
// the freshly-minted pairing token without the agent ever seeing it.
//
// Origin guard: we only accept messages from window.origin and we
// double-check origin in the background worker before storing.
//
// We also drop a small DOM marker (data-mdd-ext-version=...) on document
// element so the page can detect the extension is installed without
// waiting on a message round-trip.

const VERSION = "0.1.0";

// 1. Install marker so the page can synchronously detect the extension.
try {
  document.documentElement.setAttribute("data-mdd-ext", "installed");
  document.documentElement.setAttribute("data-mdd-ext-version", VERSION);
} catch {
  // noop — extremely defensive; documentElement is essentially always present
}

interface PairRequest {
  source: "mdd-app";
  type: "pair-request";
  token: string;
  email: string;
}

interface PingRequest {
  source: "mdd-app";
  type: "ping";
}

type AppMessage = PairRequest | PingRequest;

const isAppMessage = (data: unknown): data is AppMessage => {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.source === "mdd-app" && typeof d.type === "string";
};

window.addEventListener("message", (event) => {
  // Only accept messages from the same origin (the My Deal Desk app itself).
  if (event.origin !== window.location.origin) return;
  if (!isAppMessage(event.data)) return;

  if (event.data.type === "ping") {
    window.postMessage(
      { source: "mdd-extension", type: "pong", version: VERSION },
      window.location.origin,
    );
    return;
  }

  if (event.data.type === "pair-request") {
    const { token, email } = event.data;
    if (!token || typeof token !== "string" || !email || typeof email !== "string") {
      window.postMessage(
        { source: "mdd-extension", type: "pair-error", reason: "missing-fields" },
        window.location.origin,
      );
      return;
    }
    chrome.runtime
      .sendMessage({ type: "pair-from-page", token, email, origin: event.origin })
      .then((response: { ok: boolean; error?: string }) => {
        if (response?.ok) {
          window.postMessage(
            { source: "mdd-extension", type: "paired", email },
            window.location.origin,
          );
        } else {
          window.postMessage(
            {
              source: "mdd-extension",
              type: "pair-error",
              reason: response?.error ?? "unknown",
            },
            window.location.origin,
          );
        }
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        window.postMessage(
          { source: "mdd-extension", type: "pair-error", reason },
          window.location.origin,
        );
      });
  }
});
