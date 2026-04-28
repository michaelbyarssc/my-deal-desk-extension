import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest. Each adapter we ship adds entries to:
//   - host_permissions (the agent's MLS / forms platform domains)
//   - content_scripts.matches (so our content script runs on those pages)
//
// Permissions kept minimal: storage for the agent's pairing token,
// activeTab so we can open the popup against the current tab,
// scripting so the popup can request a re-fill if the user navigates
// after opening it.

export default defineManifest({
  manifest_version: 3,
  name: "My Deal Desk — Listing Assistant",
  short_name: "Deal Desk",
  version: "0.1.0",
  description:
    "Fill SCAR forms in Digisign and listing data in your SC MLS Add/Edit page from a single master form in My Deal Desk.",

  permissions: ["storage", "activeTab", "scripting"],

  host_permissions: [
    // Forms platforms
    "https://forms.skyslope.com/*",
    "https://*.skyslope.com/*",
    // South Carolina MLSs we plan to support — order is rollout priority.
    "https://greenville.paragonrels.com/*",
    "https://westernupstate.mlsmatrix.com/*",
    "https://next.navicamls.net/*",
    // My Deal Desk app (so the popup can call our API + read pairing token)
    "https://*.lovable.app/*",
    "https://*.supabase.co/*",
  ],

  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },

  action: {
    default_title: "My Deal Desk",
    default_popup: "src/popup/index.html",
  },

  content_scripts: [
    {
      matches: [
        "https://forms.skyslope.com/*",
        "https://*.skyslope.com/*",
        "https://greenville.paragonrels.com/*",
        "https://westernupstate.mlsmatrix.com/*",
        "https://next.navicamls.net/*",
      ],
      js: ["src/content/index.ts"],
      // Run after page is interactive — many of these sites are SPAs, so
      // the adapter's onPageChange watcher does the real activation work.
      run_at: "document_idle",
      all_frames: true,
    },
  ],

  // Allow the popup to load resources from any matched page (logos etc.)
  web_accessible_resources: [
    {
      resources: ["icons/*"],
      matches: ["<all_urls>"],
    },
  ],

  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
});
