// Digisign / SkySlope Forms adapter — STUB.
//
// Phase 2 fills the SCAR pre-MLS forms inside the Digisign form viewer
// (forms.skyslope.com). The viewer renders forms as PDF overlays; field
// inputs are addressable via the DOM. Real field-fill logic ships once we
// inspect a few SCAR templates and author maps for them.
//
// For now this stub:
//  - Matches the URL pattern.
//  - Watches for the form viewer DOM marker (lefthand "1 FORM" sidebar).
//  - Reads the form template ID from the page header.
//  - Returns "not implemented yet" from fill().

import type { SiteAdapter, AdapterContext } from "./types";
import { registerAdapter } from "./types";
import type { FillReport } from "@/types/fieldMap";

const URL_PATTERN = /^https:\/\/forms\.skyslope\.com\//;

const FORM_HEADER_SELECTOR = 'h1, [data-testid="form-title"], .form-title';

const detectFormTemplateId = (): string | null => {
  // The Digisign URL embeds the form ID in the path; UI also shows the
  // template name like "Disclosure of Real Estate Brokerage Relationships
  // (Seller) 110 - SCAR" in the page header. We use the URL as the stable
  // identifier and the header as a sanity-check label.
  const path = window.location.pathname;
  const match = path.match(/\/forms\/([^/?#]+)/i);
  if (match) return match[1];
  const header = document.querySelector(FORM_HEADER_SELECTOR);
  return header?.textContent?.trim() ?? null;
};

const digisignAdapter: SiteAdapter = {
  target: "digisign",
  label: "Digisign",

  matchesUrl(url: string): boolean {
    return URL_PATTERN.test(url);
  },

  isReadyToFill(): boolean {
    // Wait for the form viewer to render. The "1 FORM" sidebar is a stable
    // marker across all SCAR templates — appears once the form list loads.
    const sidebar = document.body.innerText?.includes("FORM");
    const hasIframe = document.querySelector("iframe") != null;
    return Boolean(sidebar && hasIframe);
  },

  detectFormTemplateId,

  async fill(_ctx: AdapterContext): Promise<FillReport> {
    const startedAt = new Date().toISOString();
    // Field-fill ships in a follow-up — needs per-template field maps
    // authored against actual SCAR forms.
    return {
      target: this.target,
      fieldMapVersion: _ctx.fieldMap.version,
      fieldsAttempted: 0,
      fieldsSucceeded: 0,
      fieldsFailed: [
        { canonical: "*", reason: "Digisign field-fill not implemented yet (Phase 2 stub)" },
      ],
      pageUrl: window.location.href,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  },
};

registerAdapter(digisignAdapter);

export default digisignAdapter;
