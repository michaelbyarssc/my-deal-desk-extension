// Greater Greenville MLS (GGAR) adapter — fills the Paragon Add/Edit form.
//
// Paragon is hash-routed (Default.mvc#2,2 = the maintenance/listing view).
// We detect "Add/Edit" mode by the presence of the INPUT MAINTENANCE side
// panel + the Standard form section. Field IDs follow the pattern
// `f_<index>` or `f_<index>_<part>` for multipart numerics like Price.
//
// The adapter walks the field map, dispatches each field to the matching
// strategy (text / multipart_thousands / select / boolean / date / textarea /
// lookup_dialog), and produces a FillReport. Non-React, vanilla HTML, so
// plain value writes work — see strategies.ts.

import type { SiteAdapter, AdapterContext } from "./types";
import { registerAdapter } from "./types";
import type { FillReport, FieldMapEntry } from "@/types/fieldMap";
import { findElement } from "../anchors";
import * as strategies from "../strategies";

const URL_PATTERN = /^https:\/\/greenville\.paragonrels\.com\//;

// Page is "ready" when the Maintain Listing panel is visible. The label is
// stable across Paragon versions.
const READY_MARKERS = ["Maintain Listing", "INPUT MAINTENANCE"];

const isReady = (): boolean => {
  const text = document.body?.innerText ?? "";
  if (!READY_MARKERS.some((m) => text.includes(m))) return false;
  // At least one f_*-style input present.
  return document.querySelector('input[id^="f_"], input[name^="f_"]') != null;
};

// Pull the canonical field's value from the agent's listing intake. Supports
// dotted paths like "rooms.0.dimensions" — the field map keeps the canonical
// name flat for now ("street_number", "list_price"), so this is mostly a
// direct lookup with a path-style fallback.
const valueAt = (intake: Record<string, unknown>, canonical: string): unknown => {
  if (canonical in intake) return intake[canonical];
  if (!canonical.includes(".")) return undefined;
  const parts = canonical.split(".");
  let cur: unknown = intake;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

const dispatchFill = async (entry: FieldMapEntry, value: unknown): Promise<strategies.FillResult> => {
  switch (entry.type) {
    case "text":
      return strategies.text(findElement(entry.anchor), value);
    case "textarea":
      return strategies.textarea(findElement(entry.anchor), value);
    case "integer":
      return strategies.integer(findElement(entry.anchor), value);
    case "decimal":
      return strategies.decimal(findElement(entry.anchor), value);
    case "currency":
      return strategies.currency(findElement(entry.anchor), value);
    case "boolean":
      return strategies.boolean(findElement(entry.anchor), value);
    case "select":
      return strategies.select(findElement(entry.anchor), value);
    case "date":
      return strategies.date(findElement(entry.anchor), value);
    case "multipart_thousands":
      if (!entry.parts) return { ok: false, reason: "multipart entry missing parts map" };
      return strategies.multipartThousands(entry.parts, value);
    case "lookup_dialog":
      return await strategies.lookupDialog(findElement(entry.anchor), value);
    default:
      return { ok: false, reason: `unknown strategy: ${entry.type}` };
  }
};

/**
 * Discover mode — scans the page for `f_*` inputs and returns metadata.
 * Used to bootstrap field maps when we don't have an exhaustive inspection
 * yet. Triggered via a special message from the popup; result is shown to
 * the agent + posted back to My Deal Desk for an admin to review.
 */
interface DiscoveredField {
  id: string | null;
  name: string | null;
  tagName: string;
  type: string | null;
  classes: string[];
  /** Best-guess label by walking previous siblings until we find text. */
  inferredLabel: string | null;
  /** For selects, the option list. */
  selectOptions?: string[];
}

const discoverFields = (): DiscoveredField[] => {
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>('input[id^="f_"], input[name^="f_"], select[id^="f_"], select[name^="f_"], textarea[id^="f_"], textarea[name^="f_"]'),
  );
  return inputs.map((el) => {
    const out: DiscoveredField = {
      id: el.getAttribute("id"),
      name: el.getAttribute("name"),
      tagName: el.tagName,
      type: el instanceof HTMLInputElement ? el.type : null,
      classes: Array.from(el.classList),
      inferredLabel: null,
    };
    // Walk back up to find a label cell. Paragon uses table-style rows where
    // the label is in a sibling td/div.
    let cursor: HTMLElement | null = el;
    for (let depth = 0; depth < 8 && cursor; depth++) {
      const prev = cursor.previousElementSibling as HTMLElement | null;
      if (prev) {
        const text = prev.innerText?.trim();
        if (text && text.length > 0 && text.length < 80) {
          out.inferredLabel = text.replace(/\s+/g, " ");
          break;
        }
      }
      cursor = cursor.parentElement;
    }
    if (el instanceof HTMLSelectElement) {
      out.selectOptions = Array.from(el.options).map((o) => o.value);
    }
    return out;
  });
};

const ggarAdapter: SiteAdapter = {
  target: "ggar",
  label: "Greater Greenville MLS",

  matchesUrl(url: string): boolean {
    return URL_PATTERN.test(url);
  },

  isReadyToFill(): boolean {
    return isReady();
  },

  async fill(ctx: AdapterContext): Promise<FillReport> {
    const startedAt = new Date().toISOString();
    const failures: Array<{ canonical: string; reason: string }> = [];
    let succeeded = 0;
    const fields = ctx.fieldMap.fields;

    for (const entry of fields) {
      const value = valueAt(ctx.intake, entry.canonical);
      try {
        const result = await dispatchFill(entry, value);
        if (result.ok) {
          succeeded++;
        } else {
          failures.push({ canonical: entry.canonical, reason: result.reason ?? "unknown" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ canonical: entry.canonical, reason: msg });
      }
    }

    return {
      target: this.target,
      fieldMapVersion: ctx.fieldMap.version,
      fieldsAttempted: fields.length,
      fieldsSucceeded: succeeded,
      fieldsFailed: failures,
      pageUrl: window.location.href,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  },
};

registerAdapter(ggarAdapter);

// Listen for a discover-mode message from the popup so the agent can dump
// field metadata from any GGAR Add/Edit page they're on.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ggar-discover") {
    if (!ggarAdapter.matchesUrl(window.location.href)) {
      sendResponse({ ok: false, error: "Not on a GGAR page" });
      return true;
    }
    sendResponse({ ok: true, fields: discoverFields() });
    return true;
  }
  return false;
});

export default ggarAdapter;
