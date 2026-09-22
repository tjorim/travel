# Legacy route coexistence and live URL transition

This decision completes #101 within the browser contract in
[103-live-browser-route-contract.md](103-live-browser-route-contract.md).
It defines route ownership and the handoff to [#40](https://github.com/tjorim/travel/issues/40)
and [apps#219](https://github.com/tjorim/apps/issues/219). It does not deploy
new routing or migrate archive content.

## Current URL inventory

The deployed archive root is `dist/`; Caddy currently serves files there after
checking `/private` and `/*/private` with the legacy auth service. The tracked
trip paths are:

| URL family | Current content and access | Transition intent |
|---|---|---|
| `/` | Public hub with links to both trips and shared private area. | Keep the hub reachable; remove or update links as each trip moves. Its later implementation is a separate application decision. |
| `/exampleland-2054/`, `/example-trip/` | Public trip pages. The example trip is sample content, not an automatically publishable real trip. | Preserve each intentional public trip URL as an alias to the live public view only after that trip passes migration and explicit publication review. Decide separately whether to retain or remove the example. |
| `/exampleland-2054/timeline/` and fragment links | Public Taiwan story and moment anchors. | Record the old-to-new anchor mapping and verify existing links before redirecting to the live trip view. If a moment has no approved live counterpart, keep the legacy page until its disposition is reviewed; never redirect to unrelated content. |
| `/<trip>/public/trip.json`, Taiwan `public/route-map.geojson`, `public/media/manifest.json`, and public media paths | Public static data and assets used by legacy pages. | Serve only with their legacy page until cutover. Do not use as live API responses or leave them reachable after retiring the corresponding legacy page; return 404/410 or an audited redirect to a deliberately public replacement asset where semantics match. |
| `/private/`, `/private/documents/`, `/private/emergency-contacts/` and their manifest/files | Shared legacy protected pages and files. | Keep behind legacy auth until separately migrated and verified; then retire each old file URL. They never become public aliases. |
| `/<trip>/private/`, `/<trip>/private/documents/`, private JSON, GeoJSON, manifests and files | Legacy protected trip details; example-trip also has a private page. | Keep behind legacy auth until migration, then retire old file paths. Owner access moves to `/tracker/trips/{trip_id}` and authorized owner API/file delivery, without redirecting an old sensitive file URL to a browser shell. |
| `/assets/travel/*`, `/travel-offline-service-worker.js`, `/login`, `/logout` | Shared legacy code, root-scoped document worker, and password-session endpoints. | Serve only while required by remaining legacy pages. Retire their use after the last dependent route moves; do not apply the legacy auth session to live visitor routes. |

Inventory includes both slash and `index.html` forms of a page URL, query
strings, bookmarks, and the linked fragment IDs. #40 must also inventory
untracked deploy files, Git LFS originals and cached copies; this table is the
tracked route baseline, not an assertion that every production asset is in Git.

## Route ownership during coexistence

| Path | Owner before and during migration | Owner after its cutover |
|---|---|---|
| `/tracker/*` | Tracker application shell and owner session | Same |
| `/api/v1/*` | Travel API, including scoped public/share projection endpoints | Same; no static fallback for any API status |
| `/trips/{slug}` | Live public browser shell; API resolves publication by slug | Same |
| `/share/{token}` | Live unlisted browser shell; API resolves capability on every request | Same |
| Exact registered legacy public page paths | `dist/` while that trip is legacy | Live public shell alias for the reviewed slug, or an explicit same-purpose redirect; never a static fallback |
| Exact legacy data, media and protected paths | `dist/` under the existing public/private boundary while needed | Removed or explicitly redirected only to an equivalent, authorized resource |
| Other paths | Explicit hub/static asset routes or 404 | Explicit routes or 404; no catch-all trip/SPA fallback |

Reserve `/trips`, `/share`, `/tracker`, `/api`, `/private`, `/assets`, `/login`
and `/logout` from legacy trip slugs and future public slug aliases. Match live
prefixes before static serving, and use an explicit allowlist for each legacy
trip path. A live request's 404, 401/403, unavailable capability, API failure
or network failure must remain in the live boundary. It must never fall through
to `dist/<slug>/`, an old JSON file, owner data, or a cached legacy page.
Likewise, a legacy private path remains authenticated while it exists; a
visitor route cannot acquire the legacy private session as a data source.

For a migrated trip, `/<legacy-slug>/` remains a working public link and
loads the same data-free live shell as `/trips/{slug}`. Both request only
`GET /api/v1/public/trips/{slug}` and obey its current publication state and
scope. The alias may redirect to `/trips/{slug}` after bookmark, fragment,
indexing and rollback checks establish that the redirect preserves the link's
meaning. An unpublished or missing projection produces the live unavailable
response at both paths, even if the old static page still exists on disk.
An unlisted `/share/{token}` has no legacy equivalent and no alias under a
trip directory. No migration automatically publishes legacy public files or
turns a private URL into an unlisted URL.

## Cutover gates and handoff

[#40](https://github.com/tjorim/travel/issues/40) owns the per-trip content
inventory, import and owner review: map legacy slug and deep links to canonical
records, reserve the public slug, explicitly select/publicly publish a scope,
verify object hashes and access classes, compare approved live views with old
pages (including moments, media and links), check 404/unpublished behavior,
and record retained/retired URLs plus rollback evidence. Its migration plan
must include the shared `/private/` area and decide the example-trip's fate.
Do not switch a trip merely because records were imported.

[apps#219](https://github.com/tjorim/apps/issues/219) owns the VPS route
allowlist and staged switch: direct `/tracker/*`, `/api/v1/*`, `/trips/*` and
`/share/*` to their proper application boundaries; keep unmigrated legacy
routes and their private auth; switch only reviewed legacy public aliases;
block static fallback for live paths and after-cutover aliases; and retire
deployed trip files only after #40's parity and rollback gate. Apply the
unlisted no-store, no-referrer, noindex and token-log protections from #103 to
success and unavailable responses. Check a deployment can reverse an alias
switch without restoring an older public scope or exposing private files.

The legacy document viewer registers `/travel-offline-service-worker.js` with
scope `/` and can hold explicitly saved private documents in Cache Storage.
Before serving live visitor routes to existing browsers, #40 and apps#219
must verify that worker cannot answer `/trips/*`, `/share/*`, their API calls,
or a switched alias from its old cache. Ship and verify a worker/cache
retirement path for existing registrations while preserving the documented
owner consent/deletion behavior for saved private copies. The `/tracker/`
worker remains scoped to `/tracker/`.

For each staged switch, test anonymous and signed-in requests to the old
public URL, new public URL, share URL, private URL, raw legacy JSON/media URL,
and API route. Test published, unpublished, missing, revoked and expired states;
direct reloads; old bookmarks and fragments; a browser with the old worker;
and rollback. Compare response body, headers and cache behavior, including an
API error, to prove no live response receives legacy content. Record results
before removing any legacy deploy path.
