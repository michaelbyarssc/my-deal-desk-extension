// Content script entry point.
//
// Runs in every page tab matched by manifest.content_scripts. Imports each
// adapter module so they self-register, then watches the URL + DOM for
// activation. When a matching adapter says it's ready, posts a "fillable"
// message to the background worker so the popup can show the fill UI.
//
// SPA URL changes are common targets (Paragon uses hash routing, Matrix
// uses pushState) — we listen for popstate, hashchange, and observe DOM
// mutations as a fallback.

import { findAdapterForUrl, allAdapters } from "./adapters/types";

// Self-registration of adapters happens via these imports.
import "./adapters/digisign";

interface FillablePayload {
  target: string;
  label: string;
  formTemplateId: string | null;
  pageUrl: string;
}

let lastReported: FillablePayload | null = null;

const evaluate = (): void => {
  const url = window.location.href;
  const adapter = findAdapterForUrl(url);
  if (!adapter) return;
  if (!adapter.isReadyToFill()) return;

  const payload: FillablePayload = {
    target: adapter.target,
    label: adapter.label,
    formTemplateId: adapter.detectFormTemplateId?.() ?? null,
    pageUrl: url,
  };

  // Skip duplicate reports for the same target + template + url combo.
  if (
    lastReported &&
    lastReported.target === payload.target &&
    lastReported.formTemplateId === payload.formTemplateId &&
    lastReported.pageUrl === payload.pageUrl
  ) {
    return;
  }

  lastReported = payload;
  chrome.runtime.sendMessage({ type: "fillable", payload }).catch(() => {
    // Service worker may be asleep — that's fine, popup re-asks on open.
  });
};

const startWatching = (): void => {
  // Initial evaluation.
  evaluate();

  // SPA URL changes.
  window.addEventListener("popstate", evaluate);
  window.addEventListener("hashchange", evaluate);

  // pushState / replaceState don't fire events natively — wrap them.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const result = origPush.apply(this, args);
    queueMicrotask(evaluate);
    return result;
  };
  history.replaceState = function (...args) {
    const result = origReplace.apply(this, args);
    queueMicrotask(evaluate);
    return result;
  };

  // DOM mutation fallback. Debounced so SPA rerenders don't thrash us.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      evaluate();
    }, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

// Listen for fill requests from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "request-fill") {
    const adapter = findAdapterForUrl(window.location.href);
    if (!adapter) {
      sendResponse({ ok: false, error: "No adapter for this page" });
      return true;
    }
    if (!adapter.isReadyToFill()) {
      sendResponse({ ok: false, error: "Page not ready to fill" });
      return true;
    }
    adapter
      .fill({ intake: msg.intake, fieldMap: msg.fieldMap })
      .then((report) => sendResponse({ ok: true, report }))
      .catch((e: unknown) => {
        const errMsg = e instanceof Error ? e.message : String(e);
        sendResponse({ ok: false, error: errMsg });
      });
    return true; // keep the message channel open for async response
  }
  if (msg?.type === "ping-content") {
    sendResponse({ ok: true, adapters: allAdapters().map((a) => a.target) });
    return true;
  }
  return false;
});

// Wait for body to exist before starting (run_at:document_idle should
// guarantee this, but iframes can be earlier).
if (document.body) {
  startWatching();
} else {
  document.addEventListener("DOMContentLoaded", startWatching, { once: true });
}
