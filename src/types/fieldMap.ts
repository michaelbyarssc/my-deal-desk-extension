// Field-map shape — the JSON the extension fetches from the My Deal Desk
// `extension_field_maps` table for each adapter target. Authored server-side
// so we can hot-fix when an MLS or forms platform changes its markup.

export type AnchorBy = "id" | "name" | "labelText" | "selector";

export interface FieldAnchor {
  by: AnchorBy;
  value: string;
}

export type FieldStrategy =
  | "text"
  | "currency"
  | "integer"
  | "decimal"
  | "boolean"
  | "select"
  | "lookup_dialog"
  | "multipart_thousands"
  | "date"
  | "textarea";

export interface FieldMapEntry {
  /** Dotted path into the listing_intakes row, e.g. "pricing.list_price". */
  canonical: string;
  /** How to find the input in the page DOM. */
  anchor: FieldAnchor;
  /** Fill strategy. Drives event synthesis + multipart handling. */
  type: FieldStrategy;
  /** For multipart/lookup strategies: extra anchors keyed by part name. */
  parts?: Record<string, FieldAnchor>;
  /** Optional named transform (e.g. "phone_digits_only"). */
  transform?: string;
  /** Optional human label (used in fill telemetry / UI). */
  label?: string;
}

export interface PageMatcher {
  urlPattern: string;
  domAnchor?: string;
}

export interface FieldMap {
  target: string;
  formTemplateId?: string;
  version: string;
  pageMatchers: PageMatcher[];
  fields: FieldMapEntry[];
}

/** What we send back to the My Deal Desk app after a fill attempt. */
export interface FillReport {
  target: string;
  fieldMapVersion: string;
  fieldsAttempted: number;
  fieldsSucceeded: number;
  fieldsFailed: Array<{ canonical: string; reason: string }>;
  pageUrl: string;
  startedAt: string;
  finishedAt: string;
}
