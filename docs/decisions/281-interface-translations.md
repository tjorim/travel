# Interface translation plan (#281)

Planning inventory audited against this checkout on 2026-09-29. This records
implementation decisions; the foundation slice (#284) now ships shared-shell translations.
The stable API error contract (#285) now ships; see [API error descriptors](../api-errors.md).
The owner record slice (#286) now ships for the inventoried owner pages, shared
editors, itinerary, places, routes, stays, updates, tasks and map controls.
Shared visibility controls and the `location_repeats_area` / `visit_restates_route`
warning messages are included because record editors use them. The remaining
asset/publication/offline surfaces stay tracked by #287; visitor projection and
its formatting stay tracked by #288. The final inventory audit remains #289.

Owner record verification covers live client validation and success notices,
dirty dialog dismissal, focus and control identity, pending-save payloads,
0/1/multiple plural forms, render-time enums, authored map-label updates without
rebuilding the map, and new Markdown placeholders without rewriting old source.
Browser review uses fictional trip data, with both languages in light/dark themes
and a 375 px layout check.

The retired `dist/` archive is excluded. Catalogues contain application copy only.

## Decisions

- Use Paraglide JS v2/Inlang, Dutch (`nl`) base/fallback and English (`en`).
  French and other locales require a later language-set decision; no extra
  catalogue or delivery work is assumed now.
- Store an explicit device-local preference as `nl` or `en` in `travel-locale`.
  Validate stored values; ignore unsupported/malformed values. Otherwise select
  the first supported language from `navigator.languages` (fall back to
  `navigator.language`), normalizing regional tags such as `en-GB` and `nl-BE`,
  then Dutch. Catch unavailable storage on read/write and retain the selected
  locale in memory. No account preference, API round-trip or locale URL.
- Switch in place through a shared subscribed React locale boundary and
  `setLocale(next, { reload: false })`. Keep router/provider/editor identities
  stable. The foundation issue must spike the custom resolver/storage behavior
  and React rerendering before extraction. Do not silently replace this with
  reload; an unsuccessful spike requires an explicit revised decision and
  existing dirty-editor guards. State, uploads, selection and focus survive.
- Offer Nederlands / English on signed-out and authenticated owner shells and
  every visitor shell, with Base UI-backed controls, field labels and keyboard
  access. Share the preference across entry points. Coordinate #279's generated
  controls without creating another control or colour system.
- Initialize the language before React/first UI in all four HTML documents,
  sharing #278's early-preference entry-point mechanism where available. Update
  `html.lang`, runtime generic page titles/descriptions and locale formatting
  on switches. Keep static/no-JS HTML in Dutch and the install-time manifest
  name/short_name **Travel**, with unchanged start_url/scope. A runtime switch
  does not rename an installed app. No localized manifest or SEO routes.
- Keep `/admin/`, `/`, `/trips/<slug>`, `/share/<token>`, stable anchors, OIDC
  callbacks, API paths, slug/token values and privacy headers unchanged.
- Day.js display locale follows the interface; Intl receives the selected
  locale explicitly. Preserve each display's existing timezone, UTC date-only
  interpretation and precision. Do not localize machine ISO values or alter
  datetime-local/number inputs, validation parsing, integer grams or payloads.
- Backend errors gain stable codes, safe structured parameters and field paths,
  retaining diagnostic detail/status/headers for compatibility. Pydantic
  validation uses type/loc and safe constraint parameters, never submitted
  input. Client renders known descriptors through messages and unknown errors
  through a localized operation fallback, retaining safe diagnostics separately.
  No translation by prose matching; no duplicated backend message catalogues.
  Existing errors/notices must rerender when locale changes. Preserve deliberate
  public/share unavailable ambiguity and sanitize provider diagnostics.
- Authored titles, prose/Markdown, captions, alt text, places, filenames, personal
  packing templates and copied records remain as written. Translate app-created
  defaults and Markdown snippet placeholders only at new insertion/creation.
  Never infer that a stored label is app-owned merely because it matches a
  default. The backend's `Packing list` fallback remains a compatibility literal.
  Offline chrome translates from canonical data; snapshots and leases remain
  owner-scoped, encrypted and unchanged in privacy. Audit older derived labels
  for compatible rendering without rewriting authored fields.

## Source inventory and extraction ownership

Paths below are relative to `frontend/src/` unless stated otherwise. Each row
covers visible text, placeholders, validation/feedback, tooltips, accessible
names/descriptions/live regions, singular/plural counts and empty/error/loading
states in those files. Re-audit new production files at the final gate. Tests,
internal identifiers, URLs, provider brands/attribution and protocol text are
not messages; their user-facing wrappers are.

| Surface | Source files | Specific extraction and formatting concerns | Slice |
| --- | --- | --- | --- |
| Build and initial document | `../package.json`, `../vite.config.ts`, `main.tsx`, `visitor-main.tsx`, `App.tsx`, `../index.html`, `../landing.html`, `../public.html`, `../share.html`, `../public/manifest.webmanifest` | Compile/check workflow, initial language, titles/description, root subscription, fixed Travel manifest metadata | Foundation |
| Owner/shared shell | `Boundary.tsx`, `tracker-routes.tsx`, `pages/Settings.tsx` | Frozen navigation array, sign-in/account/session notices, headings, provider connection feedback/confirmations; appearance selector from #278 | Foundation |
| Visitor shell and state | `visitor-routes.tsx`, `saved-shared-trips.ts` | Index/loading/retry/not-found/unavailable states, saved-link controls, storage failure, generic titles; saved trip titles are authored | Foundation then visitor |
| Owner page workflows | `pages/OwnerHome.tsx`, `pages/Trips.tsx`, `pages/TripWorkspace.tsx`, `pages/TripDetail.tsx`, `pages/Capture.tsx`, `pages/Callback.tsx`, `auth.ts`, `auth-context.tsx` | Navigation/tabs, overview summaries, capture and auth failures, dashboard dates, interpolated record names | Owner records |
| Shared editors and controls | `RecordDialog.tsx`, `forms/fields.tsx`, `forms/useRecordForm.ts`, `forms/useRecordDialog.ts`, `forms/useConfirmation.tsx`, `ui/field.tsx`, `ui/ChoiceGroup.tsx`, `ui/TravelTextarea.tsx`, `ui/TravelCheckbox.tsx`, `ui/SuggestInput.tsx`, `ui/SearchCombobox.tsx` | Dirty/discard/delete prompts, pending saves, server field errors, search/select empty labels, validation and accessible feedback; no reset on locale change | Owner records |
| Markdown authoring/rendering | `forms/MarkdownField.tsx`, `forms/markdown-snippets.ts`, `Markdown.tsx` | Toolbar and preview/status, newly inserted vet/cursief/Kop/Taak/linktekst placeholders; existing source and sanitized HTML stay authored | Owner records then visitor |
| Trip overview/itinerary | `trips/TripOverview.tsx`, `trips/TripEditor.tsx`, `trips/AgendaView.tsx`, `trips/AreaContents.tsx`, `trips/VisitRouteHint.tsx` | Badges, next action, local clocks, nights/counts, warning identifiers, kind labels (including raw kind in accessible names) | Owner records |
| Places and visits | `trips/AreaManager.tsx`, `trips/LocationManager.tsx`, `trips/VisitManager.tsx`, `trips/PlacePicker.tsx`, `trips/PlaceSearchField.tsx` | Grouped picker/search/results, merging/dependency errors, address/coordinate help, visit time validation; replace lowercased label fragments with whole messages | Owner records |
| Routes, stays, updates and tasks | `trips/RouteManager.tsx`, `trips/StayManager.tsx`, `trips/TravelUpdateManager.tsx`, `trips/TripTaskManager.tsx`, `trips/CaptureDialog.tsx` | Travel modes, booking/precision/status enums, schedule timezone labels, client validators, capture feedback and linked-resource labels | Owner records |
| Maps | `TripMap.tsx`, `trips/OwnerTripMap.tsx`, `trips/RouteGeometryEditor.tsx`, `map-style.ts` | MapLibre built-in control locale, custom controls/markers/route-in-words, tile/WebGL failures, geometry errors/offline states; provider attribution/basemap labels unchanged | Owner records then visitor |
| Library and private files | `pages/Library.tsx`, `library/DocumentLibraryManager.tsx`, `library/EmergencyInfoManager.tsx`, `library/LinkedLibraryDocuments.tsx`, `trips/DocumentManager.tsx` | Upload/download/delete, emergency kinds, filename fallbacks, offline pin/refresh/remove status; authored names and medical notes excluded | Owner assets/offline |
| Private media | `trips/MediaManager.tsx` | Import/upload/progress, capture hints, review/derivative purpose enum maps, captions/alt/focal editing, availability and confirmations; brand names unchanged | Owner assets/offline |
| Publication and preview | `trips/PublicationManager.tsx`, `trips/visibility.tsx`, `trips/RenderedPreview.tsx` | Scope/precision/field summaries, counts, link lifecycle/expiry, preview failure; scope/API identifiers and token handling unchanged | Owner assets/offline |
| Packing | `trips/PackingManager.tsx`, `trips/PackingOfflineView.tsx` | Bags/types/categories, progress/weight, departure/essential checks, copy/template/suggestion controls, pending toggle/retry, default Paklijst, unassigned/uncategorized fallbacks, hard-coded nl-BE number format | Owner assets/offline |
| Offline storage and reopening | `offline/OfflineManager.tsx`, `offline/useOfflineCopies.ts`, `offline/offline-store.ts`, `../public/service-worker.js` | Resource kind/status/lease/error copy, saved timestamps and snapshot-derived labels; worker has no visible copy but reopening/cache behavior requires verification | Owner assets/offline |
| Visitor projection | `ProjectionView.tsx` | Story headings/precision dates, timeline/gallery/lightbox, file/availability messages, selected-content summaries and navigation; user alt/captions unchanged | Visitor |
| Shared formatting/model | `dayjs.ts`, `tracker-model.ts` | Dutch global locale, date-only UTC helpers, instant/timezone helpers, enum labels, counts, validation, popup file failures; retain local-time conversion algorithms | Foundation then relevant extraction slices |
| Network/query errors | `query/api.ts`, `query/owner-queries.ts`, `query/OwnerQueryProvider.tsx`, `query/client.ts` | Current API detail strings/Pydantic msg exposure, module-level offline/auth messages, operation fallbacks and cached errors; descriptors instead of frozen prose | Stable API errors then relevant slices |
| Routes and infrastructure helpers | `router.tsx`, `router/search-params.ts`, `query/keys.ts`, `vite-env.d.ts`, `tailwind.css`, `styles.css` | Route/parameter/theme/style invariance; no new translation paths or presentation system | Final audit |

Backend contract inventory: `backend/app/routers/` (trips, areas, locations,
visits, stays, routes, tasks, packing, documents, library, media, places,
placement, visibility, publication and markdown), `main.py`, `auth.py`,
`schemas.py`, document/library/media services, media OAuth/provider adapters,
places search, navigation/access/capability/live_scopes/projection and
route_overlap/overview validation paths. Trace helpers to endpoint failures,
including `detail=str(error)`, dynamic dependency/reference lists and Pydantic
validators. Keep ownership, indistinguishable public/link 404s and file headers.
MCP consumes the same service errors but is not a translated UI. Task reminder
emails/inbox payload text is a separate delivery channel: preserve authored task
text and protocol payloads; this plan introduces no server-side locale setting.

## Ordered implementation issues

1. [#284](https://github.com/tjorim/travel/issues/284) Add Paraglide Locale Foundation and Translate Shared Shell.
2. [#285](https://github.com/tjorim/travel/issues/285) Add Stable API Error Codes for Localized Travel Feedback.
3. [#286](https://github.com/tjorim/travel/issues/286) Translate Owner Trip Workspaces and Record Editors.
4. [#287](https://github.com/tjorim/travel/issues/287) Translate Owner Assets Publication and Offline Packing Views.
5. [#288](https://github.com/tjorim/travel/issues/288) Translate Public and Unlisted Trip Presentation.
6. [#289](https://github.com/tjorim/travel/issues/289) Audit Complete Dutch and English UI Extraction and Locale Regressions.

The first issue is deliberately bounded; untouched screens stay usable in Dutch
until their extraction slice. Stable API errors precede completion of localized
feedback. The final audit depends on every extraction issue and closes the
coverage gap explicitly. #278 owns dark theme behavior; #279 owns shared control
generation. Both are coordinated, not duplicated here. No VPS/infrastructure
change or automatic content translation is proposed.

## Verification gate

Every implementation issue requires Dutch/English coverage, typed interpolation,
key/placeholder parity, plural tests, route/access invariance, keyboard behavior,
narrow-layout review, screenshots and frontend lint/format/test/build. Backend
contract changes also require locked pytest/Ruff (migration checks if applicable).
The final audit reviews signed-out shell, owner overview/settings/capture,
record/discard dialogs, library/media/publication/maps, packing/offline reopening,
public index/story/gallery and unlisted routes in both languages and both themes.
It proves dirty editor/upload/focus preservation, existing-error retranslation,
storage-denial fallback, date-only/timezone/input invariance, unchanged projection
allowlists and share privacy headers. New interface copy must enter catalogues;
update contributor guidance when the foundation is available.

## Foundation delivery (#284)

Paraglide v2 compiles Dutch/English catalogues before check, test and build; Vite
regenerates them during development. Generated declarations/output are ignored.
The pinned Inlang message-format plugin keeps catalogue compilation reproducible.
All four documents run the blocking device-locale bootstrap before React, next
to the appearance bootstrap. The custom `custom-travel` strategy persists a
validated choice and retains it in memory when storage is denied.

`LocaleBoundary` publishes a changing context without keys or recreated providers;
message-rendering components subscribe with `useLocale()`. Call `changeLocale()`
for in-place switching (`setLocale(next, { reload: false })`), document metadata
and Day.js updates. `LocaleControl` uses the shared Base UI ChoiceGroup, including
an embedded selector inside record dialogs so modal focus containment permits
switching while editing. Intl display helpers receive the selected locale.
Settings stores render-time message functions, including confirmation copy, and
uses localized operation fallbacks rather than exposing provider diagnostics.
Stable structured API error extraction remains tracked by #285.

Delivered copy covers Boundary/navigation/account, Settings/provider feedback,
appearance controls, generic owner sign-in/loading/unavailable states and
visitor shell/index/loading/error/empty/not-found/saved
link controls. Authored trip fields remain unchanged. Owner page workflows and
full visitor projections remain owned by #286–#288; #289 audits final coverage.

Regression tests cover regional preference resolution, invalid and denied storage,
all HTML entry points, key/placeholder parity and 0/1/multiple plurals, dirty
dialog text/upload/focus/cache/URL preservation, and date-only/timezone/numeric
formatting invariance. The offline shell caches the bootstrap alongside appearance.
