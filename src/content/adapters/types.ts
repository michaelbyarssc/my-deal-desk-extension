// Site-adapter contract. Each MLS / forms platform implements one of these.
// The content script's router (src/content/index.ts) instantiates the
// matching adapter based on URL and forwards lifecycle events to it.

import type { FieldMap, FillReport } from "@/types/fieldMap";

export interface AdapterContext {
  /** The agent's selected listing intake row, fetched from My Deal Desk. */
  intake: Record<string, unknown>;
  /** The active field map for this adapter's target. */
  fieldMap: FieldMap;
}

export interface SiteAdapter {
  /** Identifier matching the `target` enum on My Deal Desk. */
  readonly target: string;
  /** Human-friendly label for UI. */
  readonly label: string;

  /**
   * Returns true if the current URL is one this adapter handles.
   * Pure URL check — fast, no DOM access.
   */
  matchesUrl(url: string): boolean;

  /**
   * Returns true once the page is in the "fillable" state we want
   * (e.g. the Add/Edit form is rendered, or the form-completion view
   * has loaded inside Digisign). Adapters poll this on a MutationObserver
   * since most targets are SPAs.
   */
  isReadyToFill(): boolean;

  /**
   * Read the current form template ID (Digisign / dotloop forms only).
   * Returns null when the adapter is page-level, not template-level.
   */
  detectFormTemplateId?(): string | null;

  /** Run the fill. Returns a FillReport; throws only on unrecoverable errors. */
  fill(ctx: AdapterContext): Promise<FillReport>;
}

/**
 * Adapter registry. Adapters self-register when their module is imported
 * by the content script entry point.
 */
const adapters: SiteAdapter[] = [];

export const registerAdapter = (a: SiteAdapter): void => {
  adapters.push(a);
};

export const findAdapterForUrl = (url: string): SiteAdapter | null => {
  return adapters.find((a) => a.matchesUrl(url)) ?? null;
};

export const allAdapters = (): readonly SiteAdapter[] => adapters;
