# Interface translation decisions (#281)

The application uses Dutch and English interface messages across owner, public
and unlisted views. See [contributor guidance](../interface-translations.md) for
the repeatable audit and [API descriptors](../api-errors.md) for error contracts.
Catalogues contain application copy only; authored content and the retired
`dist/` archive are excluded.

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
  stable. State, uploads, selection and focus survive locale switches.
- Offer Nederlands / English on signed-out and authenticated owner shells and
  every visitor shell, with Base UI-backed controls, field labels and keyboard
  access. Share the preference across entry points and use existing shared controls.
- Initialize the language before React/first UI in all four HTML documents,
  alongside the appearance bootstrap. Update
  `html.lang`, runtime generic page titles/descriptions and locale formatting
  on switches. Keep static/no-JS HTML in Dutch and the install-time manifest
  name/short_name **Travel**, with unchanged start_url/scope. A runtime switch
  does not rename an installed app. No localized manifest or SEO routes.
- Keep `/admin/`, `/`, `/trips/<slug>`, `/share/<token>`, stable anchors, OIDC
  callbacks, API paths, slug/token values and privacy headers unchanged.
- Day.js display locale follows the interface; Intl receives the selected
  locale explicitly. Preserve each display's existing timezone, UTC date-only
  interpretation and precision. Do not localize machine ISO values or alter
  number inputs, validation parsing, integer grams or payloads. (Date, time and
  date-time inputs were later replaced by locale-aware fields: see
  [#293](293-locale-aware-date-time-fields.md).)
- Backend errors use stable codes, safe structured parameters and field paths,
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

## Source audit coverage

Paths are relative to `frontend/src/` unless stated otherwise. Review visible
copy, placeholders, validation/feedback, tooltips, accessible names/descriptions,
live regions, plural counts and loading/empty/error states. Include new production
files; tests and generated output are excluded.

| Surface | Source files | Specific extraction and formatting concerns |
| --- | --- | --- |
| Build and initial document | `../package.json`, `../vite.config.ts`, `main.tsx`, `visitor-main.tsx`, `App.tsx`, `../index.html`, `../landing.html`, `../public.html`, `../share.html`, `../public/manifest.webmanifest` | Compile/check workflow, initial language, titles/description, root subscription, fixed Travel manifest metadata |
| Owner/shared shell | `locale.tsx`, `appearance.tsx`, `Boundary.tsx`, `tracker-routes.tsx`, `pages/Settings.tsx` | Frozen navigation array, sign-in/account/session notices, headings, provider connection feedback/confirmations; appearance selector from #278 |
| Visitor shell and state | `visitor-routes.tsx`, `saved-shared-trips.ts` | Index/loading/retry/not-found/unavailable states, saved-link controls, storage failure, generic titles; saved trip titles are authored |
| Owner page workflows | `pages/OwnerHome.tsx`, `pages/Trips.tsx`, `pages/TripWorkspace.tsx`, `pages/TripDetail.tsx`, `pages/Capture.tsx`, `pages/Callback.tsx`, `auth.ts`, `auth-context.tsx` | Navigation/tabs, overview summaries, capture and auth failures, dashboard dates, interpolated record names |
| Shared editors and controls | `RecordDialog.tsx`, `forms/fields.tsx`, `forms/useRecordForm.ts`, `forms/useRecordDialog.ts`, `forms/useConfirmation.tsx`, `ui/field.tsx`, `ui/ChoiceGroup.tsx`, `ui/TravelTextarea.tsx`, `ui/TravelCheckbox.tsx`, `ui/SuggestInput.tsx`, `ui/SearchCombobox.tsx` | Dirty/discard/delete prompts, pending saves, server field errors, search/select empty labels, validation and accessible feedback; no reset on locale change |
| Markdown authoring/rendering | `forms/MarkdownField.tsx`, `forms/markdown-snippets.ts`, `Markdown.tsx` | Toolbar and preview/status, newly inserted vet/cursief/Kop/Taak/linktekst placeholders; existing source and sanitized HTML stay authored |
| Trip overview/itinerary | `trips/TripOverview.tsx`, `trips/TripEditor.tsx`, `trips/AgendaView.tsx`, `trips/AreaContents.tsx`, `trips/VisitRouteHint.tsx` | Badges, next action, local clocks, nights/counts, warning identifiers, kind labels (including raw kind in accessible names) |
| Places and visits | `trips/AreaManager.tsx`, `trips/LocationManager.tsx`, `trips/VisitManager.tsx`, `trips/PlacePicker.tsx`, `trips/PlaceSearchField.tsx` | Grouped picker/search/results, merging/dependency errors, address/coordinate help, visit time validation; replace lowercased label fragments with whole messages |
| Routes, stays, updates and tasks | `trips/RouteManager.tsx`, `trips/StayManager.tsx`, `trips/TravelUpdateManager.tsx`, `trips/TripTaskManager.tsx`, `trips/CaptureDialog.tsx` | Travel modes, booking/precision/status enums, schedule timezone labels, client validators, capture feedback and linked-resource labels |
| Maps | `TripMap.tsx`, `trips/OwnerTripMap.tsx`, `trips/RouteGeometryEditor.tsx`, `map-style.ts`, `map-messages.ts` | MapLibre built-in control locale, custom controls/markers/route-in-words, tile/WebGL failures, geometry errors/offline states; provider attribution/basemap labels unchanged |
| Library and private files | `pages/Library.tsx`, `library/DocumentLibraryManager.tsx`, `library/EmergencyInfoManager.tsx`, `library/LinkedLibraryDocuments.tsx`, `trips/DocumentManager.tsx` | Upload/download/delete, emergency kinds, filename fallbacks, offline pin/refresh/remove status; authored names and medical notes excluded |
| Private media | `trips/MediaManager.tsx` | Import/upload/progress, capture hints, review/derivative purpose enum maps, captions/alt/focal editing, availability and confirmations; brand names unchanged |
| Publication and preview | `trips/PublicationManager.tsx`, `trips/visibility.tsx`, `trips/RenderedPreview.tsx` | Scope/precision/field summaries, counts, link lifecycle/expiry, preview failure; scope/API identifiers and token handling unchanged |
| Packing | `trips/PackingManager.tsx`, `trips/PackingOfflineView.tsx` | Bags/types/categories, progress/weight, departure/essential checks, copy/template/suggestion controls, pending toggle/retry, default Paklijst, unassigned/uncategorized fallbacks, selected-locale weight formatting |
| Offline storage and reopening | `offline/OfflineManager.tsx`, `offline/useOfflineCopies.ts`, `offline/offline-store.ts`, `offline/OfflineSnapshotView.tsx`, `../public/service-worker.js` | Resource kind/status/lease/error copy, saved timestamps and snapshot-derived labels; worker has no visible copy but reopening/cache behavior requires verification |
| Visitor projection | `ProjectionView.tsx` | Story headings/precision dates, timeline/gallery/lightbox, file/availability messages, selected-content summaries and navigation; user alt/captions unchanged |
| Shared formatting/model | `dayjs.ts`, `tracker-model.ts` | selected Day.js locale, date-only UTC helpers, instant/timezone helpers, enum labels, counts, validation, popup file failures; retain local-time conversion algorithms |
| Network/query errors | `query/api.ts`, `query/error-messages.ts`, `query/feedback.ts`, `query/FeedbackError.ts`, `query/owner-queries.ts`, `query/OwnerQueryProvider.tsx`, `query/client.ts` | Stable descriptors, operation fallbacks and cached errors; render-time messages instead of frozen prose |
| Routes and infrastructure helpers | `router.tsx`, `router/search-params.ts`, `query/keys.ts`, `vite-env.d.ts`, `tailwind.css`, `styles.css` | Route/parameter/theme/style invariance; no new translation paths or presentation system |

## Packing and offline compatibility

Packing category group identifiers come from canonical authored categories,
including an empty identifier for the UI fallback. An authored “Zonder categorie”
therefore remains a separate group. New list/reuse defaults use the language at
creation/opening; saved backend “Packing list”, bag/item/category names, copies
and personal templates are never matched or relabelled. Display weights use the
selected locale; requests still carry integer grams.

Emergency snapshots now store kind codes. Older snapshots with a Dutch kind
label use an explicit schema-enum compatibility map at render time; authored
labels, values and notes are untouched. Map snapshots v2 omit serialized action
labels and the derived-point description, rebuilding that chrome from canonical
kinds on reopening. Older map snapshots keep authored point/route labels and
rebuild derived descriptions; serialized actions are not reopened. Visit and
packing snapshots keep canonical enum values and authored text. Snapshots still
use the same subject-scoped encryption, schema envelope and leases. Open text
copies hide on removal/account changes/expiry; read-only packing views clear at
lease expiry and render the retained expiry message in the selected language.
