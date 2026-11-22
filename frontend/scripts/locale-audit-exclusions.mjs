// Whole files that hold no interface copy: authored data and development fixtures. Keep this list short and
// give each entry a reason; a trailing slash matches a directory.
export const excludedFiles = {};
// Functions that only log for developers; their string arguments are not interface copy.
export const diagnosticCallees = [];
// Exact source/value exclusions. Never approve a whole component or directory for visible copy.
export const exclusions = {
  "components/RecordDialog.tsx": {
    "li, article, tr, [data-record-row]": "CSS selector for record rows",
    "button:not([disabled]), a[href], input:not([disabled])": "CSS selector for focusable controls",
  },
  "i18n/locale.tsx": {
    Nederlands: "language autonym",
    English: "language autonym",
    "Travel ·": "fixed application title brand",
  },
  "features/visitor/CollectionIndexView.tsx": { Travel: "fixed application brand" },
  "features/visitor/TripIndex.tsx": { Travel: "fixed application brand" },
  "features/visitor/VisitorPage.tsx": { Travel: "fixed application brand" },
  "components/VisitorTopBar.tsx": { Travel: "fixed application brand" },
  "components/projection/ProjectionView.tsx": {
    "absolute top-1/3 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-travel-control-border bg-travel-surface p-0 text-travel-forest shadow-travel-card disabled:hidden":
      "utility classes of the photo strip arrows",
  },
  "components/projection/ProjectionStory.tsx": {
    "-30% 0px -60% 0px": "IntersectionObserver root margin, not copy",
  },
  "components/map/TripMap.tsx": {
    "© OpenFreeMap": "provider attribution",
    OpenMapTiles: "provider attribution",
    "© OpenStreetMap": "provider attribution",
    "© Mapterhorn": "provider attribution",
    "© Esri": "provider attribution",
    ", Maxar, Earthstar Geographics, and the GIS User Community": "provider attribution",
  },
  "app/providers/auth-context.tsx": {
    "Travel authentication context is missing.": "internal invariant diagnostic",
  },
  "lib/files.ts": { kB: "file size unit" },
  "features/trips/packing/model.ts": { kg: "SI weight unit" },
  "lib/auth.ts": { "openid profile email": "OIDC scopes" },
  "lib/map/map-style.ts": {
    "Noto Sans Regular": "provider glyph font",
    HTTP: "internal status diagnostic",
  },
  "lib/api/owner-api.ts": {
    "Invalid API response": "diagnostic kept outside interface feedback",
    Bearer: "HTTP authorization scheme",
  },
  "features/settings/Settings.tsx": {
    "Google Photos": "provider brand",
    "GoPro Cloud": "provider brand",
  },
  "features/trips/capture/CaptureDialog.tsx": { connection: "CSS class fragment" },
  "features/trips/records/merge-candidates.ts": {
    "public page": "audience name the API returns, translated where it is shown",
  },
  "features/trips/media/labels.ts": {
    "Google Photos": "provider brand",
    "GoPro Cloud": "provider brand",
  },
  "features/trips/media/CopyView.tsx": {
    "s ·": "SI seconds unit and metadata separator",
  },
  "features/library/OfflineSnapshotView.tsx": {
    "Medische notitie": "legacy enum lookup key, never rendered literally",
  },
  "features/trips/routes/RouteForm.tsx": {
    "Europe/Amsterdam": "IANA input example",
    "Asia/Taipei": "IANA input example",
    "BR-087": "service reference input example",
  },
  "components/ui/calendar.tsx": {
    "absolute inset-x-0 top-0 flex items-center justify-between": "CSS class list",
    "text-sm font-extrabold text-travel-ink capitalize": "CSS class list",
    "size-11 p-0 text-xs font-bold text-travel-muted capitalize sm:size-9": "CSS class list",
    "[&>button]:bg-primary [&>button]:font-bold [&>button]:text-primary-foreground [&>button]:hover:bg-primary":
      "CSS class list",
    "[&>button]:ring-2 [&>button]:ring-travel-forest [&>button]:ring-inset": "CSS class list",
  },
  "features/trips/stays/StayForm.tsx": {
    TW: "ISO country input example",
    "https://": "URL input example",
  },
};
// Message keys read through a computed lookup (`m[name]`), which the unused-key check cannot see by name.
// Each entry needs a reason; none is needed while every call names its message directly.
export const computedMessageKeys = {};
// Key prefixes that name no area. A key starting with one fails the audit; each entry states the reason.
export const retiredKeyPrefixes = {
  assets_:
    "catch-all prefix split into packing_, media_, publication_, sharing_, library_ and offline_",
  owner_:
    "catch-all prefix split by area: trips_, stays_, routes_, visits_, areas_, locations_, updates_, tasks_, capture_, map_, merge_, alternatives_, records_, common_ and the rest",
};
// One-word connectives and joined sentence fragments that still ship in an assembled sentence. Each entry
// is debt: replace it with a whole message (issue 371) and delete the entry. Never add one for new copy.
export const fragmentMessages = {};
