// Whole files that hold no interface copy: authored data and development fixtures. Keep this list short and
// give each entry a reason; a trailing slash matches a directory.
export const excludedFiles = {};
// Functions that only log for developers; their string arguments are not interface copy.
export const diagnosticCallees = [];
// Exact source/value exclusions. Never approve a whole component or directory for visible copy.
export const exclusions = {
  "locale.tsx": {
    Nederlands: "language autonym",
    English: "language autonym",
    "Travel ·": "fixed application title brand",
  },
  "visitor-routes.tsx": { Travel: "fixed application brand" },
  "TripMap.tsx": {
    "© OpenFreeMap": "provider attribution",
    OpenMapTiles: "provider attribution",
    "© OpenStreetMap": "provider attribution",
    "© Mapterhorn": "provider attribution",
    "© Esri": "provider attribution",
    ", Maxar, Earthstar Geographics, and the GIS User Community": "provider attribution",
  },
  "auth-context.tsx": {
    "Travel tracker authentication context is missing.": "internal invariant diagnostic",
  },
  "tracker-model.ts": { kB: "file size unit" },
  "trips/packing/model.ts": { kg: "SI weight unit" },
  "auth.ts": { "openid profile email": "OIDC scopes" },
  "map-style.ts": {
    "Noto Sans Regular": "provider glyph font",
    HTTP: "internal status diagnostic",
  },
  "query/api.ts": {
    "Invalid API response": "diagnostic kept outside interface feedback",
    Bearer: "HTTP authorization scheme",
  },
  "pages/Settings.tsx": { "Google Photos": "provider brand", "GoPro Cloud": "provider brand" },
  "trips/CaptureDialog.tsx": { connection: "CSS class fragment" },
  "trips/merge-candidates.ts": {
    "public page": "audience name the API returns, translated where it is shown",
  },
  "trips/media/labels.ts": {
    "Google Photos": "provider brand",
    "GoPro Cloud": "provider brand",
  },
  "trips/media/CopyView.tsx": {
    "s ·": "SI seconds unit and metadata separator",
  },
  "offline/OfflineSnapshotView.tsx": {
    "Medische notitie": "legacy enum lookup key, never rendered literally",
  },
  "trips/RouteManager.tsx": {
    "Europe/Amsterdam": "IANA input example",
    "Asia/Taipei": "IANA input example",
    "BR-087": "service reference input example",
  },
  "ui/calendar.tsx": {
    "absolute inset-x-0 top-0 flex items-center justify-between": "CSS class list",
    "text-sm font-extrabold text-travel-ink capitalize": "CSS class list",
    "size-11 p-0 text-xs font-bold text-travel-muted capitalize sm:size-9": "CSS class list",
    "[&>button]:bg-primary [&>button]:font-bold [&>button]:text-primary-foreground [&>button]:hover:bg-primary":
      "CSS class list",
    "[&>button]:ring-2 [&>button]:ring-travel-forest [&>button]:ring-inset": "CSS class list",
  },
  "trips/StayManager.tsx": { TW: "ISO country input example", "https://": "URL input example" },
};
