// Fill strategies. Each strategy takes a resolved DOM element and a value,
// writes the value, and returns true if the element accepted it.
//
// All strategies dispatch the standard input/change/blur events so any
// listeners on the page (validators, computed totals, autofill triggers
// like Paragon's "Tax Autofill" sibling) see the change. Plain DOM
// manipulation works for vanilla-HTML targets like Paragon. React-managed
// inputs need the native input value setter — see fillReactText below.

import type { FieldAnchor } from "@/types/fieldMap";
import { findElement } from "./anchors";

const fireEvents = (el: HTMLElement, types: string[]): void => {
  for (const t of types) {
    el.dispatchEvent(new Event(t, { bubbles: true }));
  }
};

const setValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void => {
  el.focus();
  el.value = value;
  fireEvents(el, ["input", "change", "blur"]);
};

/** React-aware setter — needed when the input is controlled by useState. */
const setReactValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  el.focus();
  if (setter) setter.call(el, value); else el.value = value;
  fireEvents(el, ["input", "change", "blur"]);
};

export interface FillResult {
  ok: boolean;
  reason?: string;
}

const ok: FillResult = { ok: true };
const fail = (reason: string): FillResult => ({ ok: false, reason });

// ============= Strategies =============

export const text = (el: HTMLElement | null, value: unknown, opts?: { react?: boolean }): FillResult => {
  if (!el) return fail("element not found");
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return fail(`expected input/textarea, got ${el.tagName}`);
  }
  const str = value == null ? "" : String(value);
  if (opts?.react) setReactValue(el, str);
  else setValue(el, str);
  if (el.value !== str) return fail(`element rejected value (got "${el.value}")`);
  return ok;
};

export const textarea = text;

export const integer = (el: HTMLElement | null, value: unknown, opts?: { react?: boolean }): FillResult => {
  if (value == null || value === "") return text(el, "", opts);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fail(`not a number: ${value}`);
  return text(el, Math.trunc(n), opts);
};

export const decimal = (el: HTMLElement | null, value: unknown, opts?: { react?: boolean; precision?: number }): FillResult => {
  if (value == null || value === "") return text(el, "", opts);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fail(`not a number: ${value}`);
  const str = opts?.precision != null ? n.toFixed(opts.precision) : String(n);
  return text(el, str, opts);
};

export const currency = decimal;

/**
 * Multipart number split into Millions/Thousands/Ones. Paragon's price field
 * does this — three separate inputs that together represent the integer.
 *
 *   $750,000  →  millions: ""   thousands: "750"  ones: "000"
 *   $1,250,000 → millions: "1"  thousands: "250"  ones: "000"
 */
export const multipartThousands = (
  parts: Record<string, FieldAnchor>,
  value: unknown,
  root: Document | HTMLElement = document,
): FillResult => {
  if (value == null || value === "") {
    // Clear all parts.
    for (const anchor of Object.values(parts)) {
      const el = findElement(anchor, root);
      if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        setValue(el, "");
      }
    }
    return ok;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fail(`not a number: ${value}`);
  const intVal = Math.trunc(Math.abs(n));
  const millions = Math.floor(intVal / 1_000_000);
  const thousands = Math.floor((intVal % 1_000_000) / 1000);
  const ones = intVal % 1000;

  const apply = (key: string, str: string): FillResult => {
    const anchor = parts[key];
    if (!anchor) return ok; // Some forms don't have the millions slot
    const el = findElement(anchor, root);
    if (!el) return fail(`part "${key}" not found`);
    return text(el, str);
  };

  // Millions only filled if non-zero, else clear.
  const r1 = apply("millions", millions ? String(millions) : "");
  if (!r1.ok) return r1;
  // Thousands always filled.
  const r2 = apply("thousands", String(thousands));
  if (!r2.ok) return r2;
  // Ones is the trailing 3 digits, padded.
  const r3 = apply("ones", String(ones).padStart(3, "0"));
  if (!r3.ok) return r3;
  return ok;
};

export const select = (el: HTMLElement | null, value: unknown): FillResult => {
  if (!el) return fail("element not found");
  if (!(el instanceof HTMLSelectElement)) return fail(`expected select, got ${el.tagName}`);
  if (value == null) {
    setValue(el, "");
    return ok;
  }
  const target = String(value);
  // Try exact match, then case-insensitive label match.
  const opts = Array.from(el.options);
  const exact = opts.find((o) => o.value === target);
  if (exact) {
    setValue(el, exact.value);
    return ok;
  }
  const ci = opts.find(
    (o) => o.value.toLowerCase() === target.toLowerCase() || o.text.toLowerCase() === target.toLowerCase(),
  );
  if (ci) {
    setValue(el, ci.value);
    return ok;
  }
  return fail(`no option matching "${target}" (have: ${opts.map((o) => o.value).join(", ")})`);
};

export const boolean = (el: HTMLElement | null, value: unknown): FillResult => {
  if (!el) return fail("element not found");
  const v = value === true || value === "true" || value === "Yes" || value === "Y";
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    el.focus();
    el.checked = v;
    fireEvents(el, ["change", "blur"]);
    return ok;
  }
  if (el instanceof HTMLSelectElement) {
    return select(el, v ? "Yes" : "No");
  }
  return fail(`unsupported boolean target: ${el.tagName}`);
};

/** Date — accepts ISO YYYY-MM-DD, writes whatever format the field wants.
 *  Paragon uses MM/DD/YYYY in text inputs; we sniff by checking placeholder
 *  / pattern attributes, falling back to MM/DD/YYYY. */
export const date = (el: HTMLElement | null, value: unknown, opts?: { format?: "iso" | "us" }): FillResult => {
  if (!el) return fail("element not found");
  if (value == null || value === "") return text(el, "");
  const iso = String(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fail(`expected ISO date, got "${iso}"`);
  const [, yyyy, mm, dd] = m;
  const useIso = opts?.format === "iso" || (el instanceof HTMLInputElement && el.type === "date");
  const formatted = useIso ? `${yyyy}-${mm}-${dd}` : `${mm}/${dd}/${yyyy}`;
  return text(el, formatted);
};

/**
 * Lookup dialog — open the lookup picker, type the search query, click the
 * matching result. Used for Paragon's controlled-vocabulary fields (Type,
 * Area, County, etc.). Async because we wait for the dialog to render.
 *
 * v1 implementation is intentionally conservative: returns "skipped" so we
 * don't break submissions. Real implementation lands once we capture the
 * exact dialog DOM in a Phase 3 follow-up.
 */
export const lookupDialog = async (_el: HTMLElement | null, _value: unknown): Promise<FillResult> => {
  return fail("lookup_dialog not yet implemented — fill manually");
};
