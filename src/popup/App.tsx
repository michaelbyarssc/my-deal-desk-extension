// Popup UI — opens when the agent clicks the extension's toolbar icon.
//
// Three states:
//   1. Not paired:    show "Open My Deal Desk to pair" link.
//   2. Paired, page not fillable:  show pairing status + "open My Deal Desk" link.
//   3. Paired, page fillable:      show recent listings + "Fill" button.
//
// This is the shell. Field-fill action is wired through the background
// worker → content script → site adapter pipeline.

import { useEffect, useState } from "react";
import { agentpathClient, type ListingSummary } from "@/api/agentpathClient";

interface FillableInfo {
  target: string;
  label: string;
  formTemplateId: string | null;
  pageUrl: string;
}

interface Status {
  paired: boolean;
  agentEmail?: string;
  apiBase: string;
}

const Section: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 12 }}>
    {title && (
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#9aa", marginBottom: 6 }}>
        {title}
      </div>
    )}
    {children}
  </div>
);

const Btn: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode; variant?: "primary" | "ghost" }> = ({
  onClick,
  disabled,
  children,
  variant = "primary",
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      width: "100%",
      padding: "8px 10px",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer",
      border: variant === "primary" ? "none" : "1px solid #333",
      background: variant === "primary" ? "#3b82f6" : "transparent",
      color: variant === "primary" ? "white" : "#ddd",
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
);

const App = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [fillable, setFillable] = useState<FillableInfo | null>(null);
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setStatus(await agentpathClient.getStatus());

      const stateRes = await chrome.runtime.sendMessage({ type: "popup-get-state" });
      if (stateRes?.ok) setFillable(stateRes.fillable);
    })();
  }, []);

  useEffect(() => {
    if (!status?.paired) return;
    void (async () => {
      const res = await agentpathClient.listListings();
      if (res.ok) {
        setListings(res.data);
        if (res.data.length > 0) setSelectedId(res.data[0].id);
      } else {
        setMessage(`Couldn't load listings: ${res.error}`);
      }
    })();
  }, [status?.paired]);

  const triggerFill = async () => {
    if (!fillable || !selectedId) return;
    setFilling(true);
    setMessage(null);
    try {
      const intakeRes = await agentpathClient.getListing(selectedId);
      if (!intakeRes.ok) throw new Error(intakeRes.error);
      const mapRes = await agentpathClient.getFieldMap(fillable.target);
      if (!mapRes.ok) throw new Error(mapRes.error);
      const result = await chrome.runtime.sendMessage({
        type: "popup-trigger-fill",
        intake: intakeRes.data,
        fieldMap: mapRes.data,
      });
      if (!result?.ok) throw new Error(result?.error ?? "Unknown");
      const r = result.report as {
        fieldsAttempted: number;
        fieldsSucceeded: number;
        fieldsFailed: Array<{ canonical: string; reason: string }>;
      };
      void agentpathClient.reportFill(result.report).catch(() => {});
      if (r.fieldsAttempted === 0) {
        setMessage("Adapter is in stub mode — no fields filled yet.");
      } else {
        setMessage(`Filled ${r.fieldsSucceeded} of ${r.fieldsAttempted} fields.`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };

  if (!status) {
    return <div>Loading…</div>;
  }

  if (!status.paired) {
    return (
      <>
        <Section title="My Deal Desk">
          <div style={{ marginBottom: 8 }}>This extension fills SCAR forms and MLS Add/Edit pages from your master listing in My Deal Desk.</div>
          <Btn
            variant="primary"
            onClick={() => chrome.tabs.create({ url: `${status.apiBase}/settings?pair-extension=1` })}
          >
            Open My Deal Desk to pair
          </Btn>
        </Section>
      </>
    );
  }

  return (
    <>
      <Section title="Pairing">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#9ca3af" }}>{status.agentEmail ?? "Paired"}</span>
          <button
            onClick={async () => {
              await agentpathClient.unpair();
              setStatus(await agentpathClient.getStatus());
            }}
            style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}
          >
            unpair
          </button>
        </div>
      </Section>

      <Section title="Active page">
        {fillable ? (
          <div>
            <div style={{ marginBottom: 4 }}>
              <strong>{fillable.label}</strong>
            </div>
            {fillable.formTemplateId && (
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Template: {fillable.formTemplateId}</div>
            )}
          </div>
        ) : (
          <div style={{ color: "#9ca3af" }}>
            Open Digisign or your MLS Add/Edit page. The extension activates automatically.
          </div>
        )}
      </Section>

      {fillable && (
        <Section title="Listing to fill from">
          {listings === null ? (
            <div style={{ color: "#9ca3af" }}>Loading listings…</div>
          ) : listings.length === 0 ? (
            <div style={{ color: "#9ca3af" }}>No listings yet. Start one in My Deal Desk.</div>
          ) : (
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", background: "#1a1a1d", color: "white", border: "1px solid #333", borderRadius: 4 }}
            >
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.property_address ?? "(no address)"} — ${l.list_price?.toLocaleString() ?? "—"}
                </option>
              ))}
            </select>
          )}
        </Section>
      )}

      {fillable && (
        <Section>
          <Btn variant="primary" disabled={!selectedId || filling} onClick={triggerFill}>
            {filling ? "Filling…" : `Fill from listing`}
          </Btn>
        </Section>
      )}

      {message && (
        <Section>
          <div style={{ fontSize: 12, color: "#9ca3af", padding: "6px 8px", background: "#1a1a1d", borderRadius: 4 }}>{message}</div>
        </Section>
      )}
    </>
  );
};

export default App;
