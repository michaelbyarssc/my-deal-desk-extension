// Client for the My Deal Desk app's extension API.
//
// Auth model: the extension stores a long-lived pairing token in
// chrome.storage.local. The user gets one by signing into the agentpath app
// and clicking "Pair extension" (route to be added in a follow-up). The
// pairing token is exchanged for a short-lived JWT on each request.
//
// Until the pairing endpoint ships, this client falls back to reading the
// agentpath cookie / Supabase session if the user is signed into the app
// in the same Chrome profile. That's enough for the dev loop.

import type { FieldMap, FillReport } from "@/types/fieldMap";

const STORAGE_KEYS = {
  apiBase: "mdd.apiBase",
  pairingToken: "mdd.pairingToken",
  agentEmail: "mdd.agentEmail",
} as const;

// Default to the production Lovable URL. Overridable via storage for
// dev / staging.
const DEFAULT_API_BASE = "https://my-deal-desk.lovable.app";

interface ListingSummary {
  id: string;
  client_id: string;
  property_address: string | null;
  list_price: number | null;
  status: string;
  updated_at: string;
}

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: string;
}
type ApiResult<T> = ApiOk<T> | ApiErr;

const get = async <T>(key: keyof typeof STORAGE_KEYS): Promise<T | undefined> => {
  const out = await chrome.storage.local.get(STORAGE_KEYS[key]);
  return out[STORAGE_KEYS[key]] as T | undefined;
};

const set = async (key: keyof typeof STORAGE_KEYS, value: unknown): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEYS[key]]: value });
};

const apiBase = async (): Promise<string> => (await get<string>("apiBase")) ?? DEFAULT_API_BASE;

const authHeader = async (): Promise<Record<string, string>> => {
  const token = await get<string>("pairingToken");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

const apiFetch = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
  try {
    const base = await apiBase();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
      ...(await authHeader()),
    };
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
};

export const agentpathClient = {
  /** Read pairing state from chrome.storage. */
  async getStatus(): Promise<{ paired: boolean; agentEmail?: string; apiBase: string }> {
    return {
      paired: Boolean(await get<string>("pairingToken")),
      agentEmail: await get<string>("agentEmail"),
      apiBase: await apiBase(),
    };
  },

  async pair(token: string, agentEmail: string): Promise<void> {
    await set("pairingToken", token);
    await set("agentEmail", agentEmail);
  },

  async unpair(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEYS.pairingToken, STORAGE_KEYS.agentEmail]);
  },

  async setApiBase(url: string): Promise<void> {
    await set("apiBase", url);
  },

  /** List the agent's recent listing intakes — used by the popup to pick one. */
  listListings(): Promise<ApiResult<ListingSummary[]>> {
    return apiFetch<ListingSummary[]>("/functions/v1/extension-api/listings");
  },

  /** Fetch a single listing's full intake row for fill. */
  getListing(id: string): Promise<ApiResult<Record<string, unknown>>> {
    return apiFetch<Record<string, unknown>>(`/functions/v1/extension-api/listings/${id}`);
  },

  /** Fetch the active field map for a target. */
  getFieldMap(target: string): Promise<ApiResult<FieldMap>> {
    return apiFetch<FieldMap>(`/functions/v1/extension-api/field-maps/${target}`);
  },

  /** Report a fill attempt's outcome. */
  reportFill(report: FillReport): Promise<ApiResult<{ logged: true }>> {
    return apiFetch<{ logged: true }>("/functions/v1/extension-api/fill-logs", {
      method: "POST",
      body: JSON.stringify(report),
    });
  },
};

export type { ListingSummary, ApiResult };
