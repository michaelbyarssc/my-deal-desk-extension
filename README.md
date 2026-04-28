# My Deal Desk — Listing Assistant (Chrome Extension)

Phase 2 of the SC listing automation. Lives in its own repo so the Chrome
Web Store release cycle is independent of the My Deal Desk app.

## What it does

When the agent fills out the master Listing Intake in My Deal Desk and then
navigates to:

- **Digisign / SkySlope Forms** — fills the SCAR Listing Agreement, RPCD,
  agency disclosures, etc. before they're signed.
- **GGAR / WUAR / Greenwood / Spartanburg MLS Add/Edit pages** — fills the
  same data into each MLS's listing form (in priority order — GGAR first).

The extension fills DOM fields in the agent's already-authenticated session.
Credentials stay on the agent's machine; the extension only ever reads
listing data + field maps from the My Deal Desk API.

## Architecture

```
src/
├── manifest.ts               MV3 manifest — host_permissions + content_scripts per target
├── background/index.ts       Service worker: per-tab fillable state, message router
├── content/
│   ├── index.ts              Entry point — SPA URL watcher + adapter dispatch
│   └── adapters/
│       ├── types.ts          SiteAdapter interface + registry
│       └── digisign.ts       Digisign adapter (stub — Phase 2 v1)
├── popup/
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx               Popup UI: pairing, active-page status, listing picker, fill button
├── api/
│   └── agentpathClient.ts    Calls extension-api edge function on My Deal Desk
└── types/
    └── fieldMap.ts           Shared types for the field-map JSON
```

### Adapter lifecycle

Each adapter is a `SiteAdapter` from `content/adapters/types.ts`. It:

1. Self-registers on import via `registerAdapter`.
2. Implements `matchesUrl(url)` for fast routing.
3. Implements `isReadyToFill()` — usually a DOM marker check, since most
   targets are SPAs and run-at:document_idle isn't enough.
4. Optionally implements `detectFormTemplateId()` for forms platforms
   (Digisign / dotloop) so we know which template the agent's looking at.
5. Implements `fill(ctx)` — synthesizes the field-fill given the agent's
   listing intake + the field map fetched from My Deal Desk. Returns a
   `FillReport` for telemetry.

### Field maps

Fetched from the My Deal Desk `extension_field_maps` table at fill time,
versioned per target. The JSON shape is `FieldMap` in `types/fieldMap.ts`.
Hot-updatable from the server — no extension re-review needed when an MLS
or SCAR form changes its markup.

### Auth model

Long-lived pairing token in `chrome.storage.local`. The agent gets one by
clicking "Pair extension" inside My Deal Desk (route ships in a follow-up).
No MLS/Digisign credentials touch our infrastructure — those stay in the
agent's logged-in session.

## Targets supported

| Target | Platform | Status |
|---|---|---|
| Digisign | SkySlope Forms | Stub — URL match + template ID detection (Phase 2 work in progress) |
| GGAR | Paragon | Pending — Phase 3a |
| WUAR | Matrix | Pending — Phase 3b |
| Greenwood | Navica | Pending — Phase 3c |
| Spartanburg | TBD | Pending — Phase 3d (deferred until access opens) |
| dotloop | dotloop Forms | Pending — Phase 4 |

## Dev workflow

```
npm install
npm run dev          # Vite + @crxjs hot reload, loads at chrome://extensions in dev mode
npm run build        # production bundle into dist/
npm run typecheck    # tsc --noEmit
```

Loading in dev:
1. `npm run dev`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" → select `dist/` (Vite writes the built extension there)
5. Tab the extension toolbar icon to open the popup

## Adding a new MLS adapter

1. Create `src/content/adapters/<target>.ts` implementing `SiteAdapter`.
2. Import it from `src/content/index.ts` so it self-registers.
3. Add the host pattern to `manifest.ts` under `host_permissions` and
   `content_scripts.matches`.
4. Author the field map in My Deal Desk's `extension_field_maps` table
   (admin tool ships separately) and bump the version when iterating.
5. Test by opening the target page with the extension loaded — popup
   should detect and offer to fill.

## What's NOT in this repo

- Field maps live server-side in My Deal Desk's `extension_field_maps`
  table. We fetch them at fill time so they can be hot-updated.
- The `extension-api` edge function (which serves `/listings`,
  `/field-maps/:target`, `/fill-logs`) lives in My Deal Desk's
  `supabase/functions/`.
- Icons (`public/icons/icon-{16,32,48,128}.png`) — to be added before
  Chrome Web Store submission.

## Pairing token endpoint — TODO

Phase 2 needs a server-side route in My Deal Desk that:
- Lets a signed-in agent generate a long-lived pairing token.
- Returns the token + agent email to the extension via a deep link
  (`https://my-deal-desk.lovable.app/settings?pair-extension=1` opens the
  page; the page calls a Supabase edge function and posts the token back
  to the extension via `chrome.runtime.sendMessage`).

For dev, populate the token directly via DevTools:

```js
chrome.storage.local.set({
  "mdd.pairingToken": "<paste from supabase>",
  "mdd.agentEmail": "you@example.com"
});
```
