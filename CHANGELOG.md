# Changelog

All notable changes to the travel hub are documented here.

## Unreleased

### Changed

- The route, stay, visit, location and area managers, the capture dialog and the
  trip detail page are split into feature folders (`trips/routes/`, `stays/`,
  `visits/`, `locations/`, `areas/`, `capture/`, `detail/`) with owner API hooks,
  section components and dialogs, as `MediaManager`, `PublicationManager` and
  `PackingManager` were in #458 (#460). Entry points and tests are unchanged;
  there is no behaviour change.
- Private translation drafts support a mounted per-app engine credential
  (`TRAVEL_TRANSLATION_API_KEY_FILE`, #459), fail closed when its configured file
  is unavailable, and use a total request deadline with a separate connection
  timeout. Redirects, ambient proxies and automatic retries are disabled;
  operational events contain only codes and timing.

### Added

- The workspace "Jump to" search finds records as well as tabs and blocks (#461):
  areas, locations, visits, stays, routes, tasks, documents, travel updates and
  media by title, ignoring case and accents, labelled "Plan › Stays › Hotel
  Taipei". Choosing one goes to its tab, expands its block and opens its dialog.
  Matching runs in the browser over the owner lists already in the query cache;
  no request carries the search words and nothing reaches published-trip
  responses. Each kind shows at most five matches and counts the rest, so a large
  media library cannot bury the other results.

- Optional private media-worker processing for existing video derivatives
  (#457): a durable database dispatcher submits/reconciles `travel-video-v1`,
  verifies bounded video/poster results, preserves pending owner review and
  resumes cancellation/cleanup after restarts. Explicit local mode remains the
  default and rollback path. Migration 011 and `docs/media-worker.md` describe
  configuration, retry/privacy guarantees and the apps#275 production gates.

- Lazy-loaded owner routes and workspace tabs (#403): the shell, router, query
  client, home and sign-in stay in the owner entry, while Trips, trip details,
  Capture, Library, Settings and the Plan, Story, Packing, Media and Sharing
  tabs load on first use. The owner entry's initial JavaScript drops from
  1280.70 kB (380.33 kB gzip) to 494.54 kB (161.80 kB gzip). Deferred views
  show a localized loading status and, if their module cannot be fetched, a
  recovery alert whose reload action replays no write. The owner service
  worker now keeps fetched `/admin/assets/*` files (shell cache `v5`), so a view
  opened once reopens offline; a never-opened view does not. Shared labels and
  `OwnerImage` moved out of the editor modules, `pnpm bundle:check` enforces
  `bundle-budget.json` in CI, and the measurements and offline behaviour are in
  `docs/decisions/403-owner-code-splitting.md`.
- Documented owner MCP CLI checks with FastMCP 4.1's encrypted OAuth credential
  reuse, a local key outside Git, and read-only discovery commands (#381).
- Playwright smoke checks for the PWA (#371): `pnpm e2e` in `frontend/` starts
  the Vite dev server with the API mocked in the page (no owner session,
  database or media), walks owner navigation and the trip workspace tabs, loads
  the public `/trips/` and unlisted `/share/` views, and runs an
  `@axe-core/playwright` WCAG 2 A/AA scan of the visitor and owner screens in
  nl and en, light and dark, at 360 px, also failing on horizontal overflow. A
  separate `Frontend end-to-end` CI job runs it. Authenticated runs against a
  real Keycloak realm stay out of scope (tjorim/apps).
- The anonymous visitor routes are rate limited per client (#370) with
  `slowapi`: `/api/public/*` shares `TRAVEL_RATE_LIMIT_DEFAULT` (300 a minute)
  and `/api/shared/{token}*` the stricter `TRAVEL_RATE_LIMIT_SHARED` (120 a
  minute), so probing unlisted tokens is bounded across all of their file and
  navigation routes. A rejected request gets a `429` with the `rate_limited`
  error descriptor (translated in the PWA), `Retry-After` and the route's
  privacy headers, and never echoes the token. The client is the immediate peer,
  or `X-Real-IP` only when that peer is a private address (the proxy), with IPv6
  counted per /64. Counters are in-process, so the limits assume the single
  uvicorn worker of `backend/Dockerfile`; `TRAVEL_RATE_LIMIT_ENABLED=false`
  turns them off. Caddy must send `X-Real-IP` for `/api/*` before this is
  deployed, or every visitor would be throttled together (tjorim/apps#266).
- Settings gains a **Sign-in and passkeys** section whose button opens the
  owner's Keycloak account console, where passkeys and security keys are
  enrolled, renamed and removed. [docs/passkeys.md](docs/passkeys.md) records
  the sign-in and recovery model and the browser verification checklist for the
  passkey pilot (#337); the checklist is still to be completed on a real device
  once the realm policy (tjorim/apps#265) is deployed.
- The route editor takes right-click and touch long-press gestures: pressing
  the map adds a point to the nearest part of the line instead of the end, and
  pressing a numbered point removes it. Every trip map also gains a **Globe**
  (Dutch **Wereldbol**) control that switches the projection without any new
  provider request. Both use `maplibre-gl` 6.11.2, which also smooths
  camera moves over terrain, keeps satellite tiles sharp at fractional pixel
  ratios and reports worker failures through the map `error` event.
- Locations can be geocoded in place: `PATCH …/locations/{id}` and the MCP
  `update_location` tool now accept the latitude and longitude, viewport edges,
  OSM element type and id, and navigation provider fields of a verified
  `search_places` result, so a named location gains its map point without a
  replacement or merge. Omitted fields keep their value and an explicit null
  clears one; the point, the viewport and the OSM element are each set or
  cleared together, and the owner-only OSM link always follows the stored
  element. Moving an existing point must restate or null the provider fields
  of the old place, and a shared location must be made private before its point
  changes, because a shared location publishes its point. The id, area, label,
  visibility and every visit, stay, route end and reisupdate are untouched
  (#319).
- Added an `idea` status for routes, for transport that is only being compared
  (migration `010_planning_statuses`; existing routes keep their status, and
  the downgrade turns ideas back into `planned`). Routes are now `idea`,
  `planned`, `confirmed` or `cancelled`. Like stay ideas, route ideas may
  overlap, are left out of the transport progress badge, the next action,
  current whereabouts and the check for visits that restate a route, and can
  never be shared: sharing one is refused and turning a route back into an idea
  makes it private. The owner PWA lists ideas for the same journey (same areas,
  same day) together as *Alternatives*, and a chosen route offers to cancel
  them. The API and the owner MCP route tools accept and return `idea`, and the
  MCP instructions cover transport shortlists (#318).
- Added an `idea` status for stays, for hotels that are only being compared
  (migration `010_planning_statuses`; existing stays keep their status). Ideas
  may overlap each other and any other stay without a warning, never count as
  covering a night in the missing-night badge, next action, visit overnights
  or current whereabouts, and can never be shared: choosing a visibility other
  than private is refused, and turning a stay back into an idea makes it
  private and stops its delivery. The owner PWA lists ideas for the same nights
  together as *Alternatives* (**Idee** in Dutch), and a chosen stay offers to
  cancel the ideas that overlap it. The API and every owner MCP stay tool
  accept and return `idea`, and the MCP instructions tell assistants to use it
  for hotel shortlists instead of `planned` (#316).

### Changed

- MCP now accepts only Keycloak tokens issued for its own resource: the
  audience is the canonical `TRAVEL_MCP_BASE_URL` (or `TRAVEL_MCP_AUDIENCE`),
  no longer the API's `travel-api`, and startup refuses the two being equal.
  The protected-resource metadata advertises exactly that URL and is served at
  `/.well-known/oauth-protected-resource/mcp`. Clean cutover: reconnect each MCP
  client; see `docs/decisions/336-mcp-resource-audience.md`.
- Let a visit be `cancelled`, so a rejected idea or dropped plan can stay on
  record instead of being deleted (migration `010_planning_statuses`;
  existing visits keep their status, and the downgrade turns cancelled visits
  back into ideas). Visits are now `idea`, `planned`, `confirmed` or
  `cancelled`. Because the visit status is never shared, a cancelled visit
  could otherwise read as a plan to visitors: it can never be shared, and
  cancelling one makes it private and stops its delivery. The owner PWA offers
  **Geannuleerd** in the status list and shows an explanation in place of the
  share control (#316).
- Merged the `booked` status of stays and routes into `confirmed` (migration
  `010_planning_statuses`; existing `booked` records become
  `confirmed`, and the downgrade cannot tell which ones were once only
  booked). The app never enforced a difference: both counted as booked in the
  badges and next action. Stays and routes are now `idea`, `planned`,
  `confirmed` or `cancelled`, matching visits' `confirmed`. The API, owner MCP tools and archive import still accept
  `booked` and store it as `confirmed`, so older clients and
  `dist/exampleland-2054/private/app-import.json` keep working. The progress badges
  now read "x/y confirmed" (**bevestigd**) and the public projection reports
  `confirmed` for a route that was `booked` (#316).
- Stopped the frontend suite timing out on a busy machine. Vitest now has a
  project-wide 30 s `testTimeout` and `hookTimeout` (the 5 s default only
  measured host load: `RouteManager` and `PublicationManager` tests failed at
  5 s under a load average of about 16 and pass in under 2 s alone) and a
  worker cap of eight. `isolate: false` was evaluated and kept off: it saved
  CPU time but not wall time and made tests in several files fail on shared
  state. The reasoning sits next to the config in `frontend/vite.config.ts`
  (#298).
- Kept EXIF capture times as the camera's wall-clock time. A bare
  `DateTimeOriginal` carries no zone and was stored as UTC, so an owner in
  Brussels saw a photo taken at 10:15 in Taiwan as 11:15 (or on another day). The
  time is now stored as written, flagged `captured_local` on the media asset and
  on candidate times, and shown unchanged in any viewer zone, including the
  value handed to the capture dialog. No zone is guessed from areas, the trip or
  GPS. When the camera also wrote `OffsetTimeOriginal`, candidate grouping uses
  the real instant, so mixed offsets across a trip no longer split or merge
  candidates; grouping never depends on the viewer's zone. Provider capture
  times stay instants. Media stored earlier keeps its value and display
  (migration `009_media_captured_local`) (#297).
- Made the server refuse a route that starts and ends at the same place,
  whoever writes it: the owner form, the MCP route tools and batch create, the
  archive import and direct API clients now get the same 422
  (`route_ends_are_the_same_place`, shown in the interface language with the
  form's own wording). "The same" is the same location on both ends, or the same
  area on both ends with no location on either; two locations in one area or a
  whole area to a location inside it stay valid. A PATCH is judged on the
  merged stored and sent ends, but only when it changes an end, so a route
  stored earlier stays editable and is not migrated (#296).
- Stopped the three upload routes (trip media, trip documents, owner library)
  and provider imports from buffering oversized files. One shared helper reads
  at most the 200 MB limit plus one byte and refuses the rest with the same
  Dutch message and nothing stored; provider downloads are streamed and stop at
  the same limit. Starlette still spools the multipart body to a temporary file
  before the route runs, so the body-size cap in Caddy is tracked in
  tjorim/apps#257 (#294).
- Replaced the native date, time and date-time inputs in the owner PWA with
  locale-aware fields. A date is typed as "16 nov 2026" (or "16-11-2026" or ISO)
  and picked from a keyboard-accessible calendar (react-day-picker through the
  shadcn CLI); a time is a 24-hour text field; a date-time is a date and a time
  side by side. The visible format follows the interface language instead of the
  browser's, while forms and the API keep `YYYY-MM-DD`, `HH:mm` and
  `YYYY-MM-DDTHH:mm`. Unreadable text and half-filled date-times block a save and
  say why (#293).

### Fixed

- Refreshed Babel runtime lockfile resolutions for Base UI and Testing Library
  so Dependabot no longer rejects the transitive update when pnpm selects
  runtime 8 for Base UI and runtime 7 for Testing Library.
- MCP response validation failures remain payload-free and correlated with a
  single audit entry when FastMCP 4.1 wraps the original validation exception,
  including calls through the discovery proxy (#381).
- The MCP `revoke_share_link`, `create_media_derivative`,
  `inspect_public_preview_file` and `inspect_share_preview_file` tools called
  their handlers with the wrong arguments and failed; they now work, with
  regression tests. Found by adding the `ty` type checker to the backend CI.
- Switching between the light and dark theme on a trip map no longer sends the
  viewer back to the whole trip. The rebuilt map reopens on the same centre,
  zoom, pitch and bearing, and keeps the selected stop or route, the focused
  area and the terrain, satellite and globe toggles; the route editor keeps its
  view as well. Only the new style is fetched, and a changed trip still starts
  from the whole trip (#333).
- An MCP tool called with invalid arguments no longer echoes the rejected
  values to the client. FastMCP 4 wraps the pydantic error in its own
  `ValidationError`, which skipped the field-path-only handling, so the error
  carried `input_value=…`; it now names the tool, the field paths and error
  types and a reference, the same as the audit row and log line.

### Added

- Added merging of duplicate locations and areas to the owner PWA (#295). In
  "Gebieden en locaties" the owner opens a location or area, chooses what to
  keep and which duplicates fold into it, reads the API's preview (counts of the
  visits, stays, routes and reisupdates that move, who would stop seeing a
  duplicate, a location's visits moving to another area, city-level locations
  left to merge after an area merge) in the interface language, and confirms
  twice because a merge cannot be undone. Cancelling changes nothing and a failed
  preview or merge is shown inside the dialog. Likely duplicates (same name,
  same map point or same street address; areas by name or map point) are listed
  as suggestions that only open the preview, and a refused delete of a record
  that is still in use now points at the merge. The warnings are built from the
  preview's structured fields, not the API's English sentences.

- Added explicit Dutch/English draft translation for long-form owner text. A
  translate action in the Markdown editor sends the field's text to a
  self-hosted, on-demand LibreTranslate service (apps#250, apps#252) and shows an
  editable, machine-translated draft that is only added below the authored text
  on request. Requests go out paragraph by paragraph, one at a time; unreachable
  or unconfigured service failures leave the text untouched (#305).

- Completed the Dutch/English interface audit, with repeatable source/catalogue
  checks, generated message typing and frontend regression tests enforced in CI.
  Address previews, retained route validation and trip-deletion notices now
  translate in place; unexpected diagnostics use localized operation fallbacks.
  Added contributor guidance (#289).

- Completed Dutch/English visitor stories, timelines, galleries, route summaries
  and shared map links, including owner rendered previews. Dates retain the
  delivered precision and timezone; authored content, anchors and capability
  paths remain unchanged. Galleries offer a keyboard-accessible lightbox with
  focus return, translated media failures/retry and saved-link storage feedback
  (#288).

- Translated private documents, library/emergency information, media imports and
  derivatives, publication controls, preview chrome, packing and offline copies
  into Dutch and English. Language switches preserve selected uploads, dirty
  sharing scopes, pending toggles and confirmations. New packing defaults use
  the creation locale; saved names and integer grams remain unchanged. Offline
  snapshots retain canonical codes, render legacy emergency/map labels safely,
  and hide open copies on expiry or account changes (#287).

- Translated owner trip workspaces, record managers, shared dialogs, Markdown
  editing and map controls into Dutch and English. Notices, validation and enum
  labels update in place; dirty values, pending saves and authored content are
  preserved. Planning warnings use stable identifiers and new Markdown snippets
  use the current language (#286).

- Added stable API error descriptors with safe validation paths/constraints and
  provider diagnostics. Owner and visitor feedback renders Dutch/English typed
  messages from retained descriptors, including locale switches while errors
  remain visible; HTTP statuses and privacy headers are preserved (#285).

- Added the Dutch/English Paraglide locale foundation, device-local language
  selectors and translated owner/visitor shells, Settings and appearance controls.
  Switching preserves router, cache, dirty editors and uploads (#284).

- Owner and visitor views offer device-local light, dark and automatic appearance,
  applied before first paint, with themed maps, Markdown and controls (#278).
- Adopted the Base UI shadcn generator with Lucide, Travel semantic theme
  tokens and an app-owned generated checkbox; documented the generation
  workflow and existing shared-control decisions (#279).
- Recorded the Dutch/English Paraglide translation plan, source inventory,
  preference/editor-state/formatting/error decisions and ordered implementation
  issues #284–#289, including the final coverage audit (#281).

- The trip overview flags a location that only repeats its area: within a kilometre of the area's
  point and labelled with an airport code or a bare city entry. Name the area after the city or
  region and keep the location for the exact place. It only warns; nothing is hidden (#274).
- A visit that restates a route already on the trip (same day and area, at most two days long, and
  naming the journey through its service number, carrier, route label or a transport word in the
  title) is flagged, without blocking it: the visit list and detail suggest keeping the journey as
  a route, and the trip overview reports `visit_restates_route`. The visit form shows the same hint
  while the visit is being typed, before it is saved (`POST /visits/route-check`). Real stops at an airport or
  station on a travel day are left alone (#276).
- Owners can explicitly save, refresh and remove an encrypted, device-scoped
  packing copy. Its read-only offline view shows the saved time, bags, items,
  packed states, grouping and filters. Reconnect checks owner access and the
  existing lease policy; editing still requires a connection.
  ([#266](https://github.com/tjorim/travel/issues/266))

- Packing lists can be copied from another owned trip or created from one or
  more personal templates, preserving structure while resetting every item to
  unpacked. Owners can mark departure-day items, filter them, review a compact
  final check of essentials, assignments, weight limits and bag hints, and
  optionally add or dismiss suggestions from their own prior trips.
  ([#262](https://github.com/tjorim/travel/issues/262))

- Added a private Inpakken workspace tab with bag and category grouping,
  Base UI view controls, visual progress and weight summaries, direct packed
  toggles, bag/item editing, bulk actions, and item moves through editing or
  bulk selection. Item rows show only packing and editing controls; order
  buttons were removed after owner feedback. Packing selectors use the shared
  `react-select` control used by other owner forms.
  Failed toggles remain visible for retry.
  ([#261](https://github.com/tjorim/travel/issues/261))

- Owner-only packing lists now contain ordered bags and packable items, with
  bulk creation, packed state, reassignment, optional gram weights and bag
  limits. Deleting a bag leaves its items unassigned. The owner API and typed
  MCP tools share the same validation; visitor projections exclude packing.
  ([#260](https://github.com/tjorim/travel/issues/260))

- Added Tailwind CSS to the owner and visitor builds for new styling, `cn` for
  conditional classes, Oxlint rules for utility classes, and Oxfmt commands
  for frontend formatting. Frontend sources have been formatted with Oxfmt;
  existing views keep their current CSS and native record dialogs.
  ([#229](https://github.com/tjorim/travel/issues/229))

- Owner-only trip, area, location and travel-update lists now support bounded,
  case-insensitive search and offset pagination. The growing place, trip and
  media attachment, copy presentation and saved-location pickers search these
  lists as the owner types, while existing unfiltered list calls keep their
  response shape. ([#238](https://github.com/tjorim/travel/issues/238))

- Planning now groups visible locations under their areas, with direct location
  creation and a shared detail/editor dialog. Owners can correct saved address
  fields before enabling address sharing; location edits retain map points and
  refresh linked trip records. The dialog previews the exact visitor address
  fields and names the live audiences that currently receive the location.
  ([#251](https://github.com/tjorim/travel/issues/251),
  [#252](https://github.com/tjorim/travel/issues/252))
- Map markers and route lines now open persistent detail cards with shared or
  private record links, dates, endpoints and transport when available. Routes
  highlight on selection; the textual controls and “Hele reis tonen” provide
  keyboard and touch access to the same selection and full-trip view.
  Visitor details use only the published projection. ([#249](https://github.com/tjorim/travel/issues/249))
- The private trip overview shows its saved summary, complete location addresses,
  local route times with endpoint time zones and areas, stay times, task reminders,
  linked library documents, and authenticated media thumbnails beside updates and
  media records. The existing record links still open their workspace dialogs.
  ([#247](https://github.com/tjorim/travel/issues/247))
- A route can have a day before it has a train: `departs_on` is the local
  departure day in the departure time zone, so "Kaohsiung → Taipei on 5
  December, no train yet" is stored as a day without inventing a time or
  putting the date in the label. Exact `departs_at`/`arrives_at` stay optional
  and need a day (`ck_route_time_needs_a_day`); with them `departs_on` is
  derived, a different day is refused, and clearing the times keeps the day.
  Migration `005_route_departure_day` fills it for existing routes from their
  departure time in the departure zone, else the departure area's, else UTC.
  The route editor asks for the day first and the times as an optional second
  step; the Agenda places routes on their day (day-only items after the timed
  ones of that day) and lists undated visits and routes in a "Nog geen dag"
  section instead of hiding them; routes are ordered by day everywhere. The
  trip overview counts `routes_undated` next to `visits_undated`,
  `list_routes` compact rows carry `departs_on`, and the MCP route tools
  describe the day-first rule. Shared routes carry `departs_on` next to the
  times they already shared. Stays keep their required dates.
  ([#197](https://github.com/tjorim/travel/issues/197))
- The owner app's Markdown fields share one editor: a plain textarea with a
  snippet toolbar (bold, italic, heading, list, task list, link) and a Preview
  tab that the server renders through the new owner-only
  `POST /api/markdown/render`, with the same renderer as the stored fields, so
  the preview never drifts from what is saved. The remaining fields follow:
  emergency-information notes are Markdown (with a one-line `notes_text` for
  the list row), a media caption is inline Markdown only (bold, italic and
  links, `caption_html` in owner responses and the public and share-link
  media), and a stay's contact details stay plain text whose phone numbers
  (`tel:`), email and web addresses become links (`contact_details_html`).
  Markdown fields also render GFM tables, which scroll sideways within their
  card on a phone. ([#194](https://github.com/tjorim/travel/issues/194))
- Long-form text is Markdown: the trip summary, visit summary and notes,
  reisupdate body and private notes, and stay, route, task and location notes.
  Records keep storing the Markdown source; one backend renderer
  (`app/markdown.py`, `markdown-it-py` with raw HTML and images off, sanitized
  by `nh3`) supplies read-only `*_html` fields next to each source in owner
  responses and in the public page and share-link projections, so the PWA and
  visitor views inject the same sanitized HTML and carry no parser of their
  own. Headings render three levels down (`#` is `h4`), links allow only
  `http`, `https` and `mailto`, open in a new tab and are `nofollow` on visitor
  views, and task lists render as disabled checkboxes that never create trip
  tasks. Public trip cards and saved shared trips show a one-line plain-text
  `summary_text` instead. OpenAPI and MCP field descriptions mark these fields
  as Markdown; MCP tools return the source without the rendered HTML.
  ([#192](https://github.com/tjorim/travel/issues/192))
- Duplicate locations and areas can be merged, and unused areas and locations deleted,
  over the API and MCP. `POST /api/trips/{id}/locations/merge` and the
  `merge_locations` tool preview, per duplicate, how many visits, stays, routes
  and reisupdates would move and which audiences would lose a duplicate the
  kept location does not reach; with `confirm` they repoint every reference in
  one transaction, delete the duplicates and record a `location.merge` audit
  event with the counts. `DELETE /api/trips/{id}/locations/{location_id}` and
  the `delete_location` tool refuse while anything still uses the location;
  the `delete_area` tool wraps the existing area delete with the same rule.
  `POST /api/trips/{id}/areas/merge` and the `merge_areas` tool fold duplicate
  areas the same way: locations, visits, route ends and reisupdates move to the
  kept area, recorded as an `area.merge` event. The preview also lists the
  locations that only name the city, so those duplicates can be merged next.
  ([#188](https://github.com/tjorim/travel/issues/188))
- Visits have an owner-only `status`: `idea`, `planned` (the default) or
  `confirmed`. It is never part of a shared visit, so planning state no longer
  needs a "· concept" marker in a title or area label that visitors see. Areas
  keep no status of their own; an area is as settled as its visits. The visit
  editor has a Status choice, and the list calls out ideas and confirmed
  visits. ([#183](https://github.com/tjorim/travel/issues/183))
- `GET /api/trips/{id}/overview` and the `get_trip_overview` MCP tool check a
  trip in one read: counts and visibility per kind, what the public page and
  each draft or active link receive, and warnings for an active audience that
  receives nothing, shared trip dates, planning words such as "concept" in a
  label a visitor sees, shared records without a map point because their area
  is not shared, and undated visits that duplicate a dated one. The Delen
  screen shows the same review, in Dutch, above the visibility choices.
  ([#182](https://github.com/tjorim/travel/issues/182))
- The `batch_create` MCP tool adds many visits, stays, routes, reisupdates and
  tasks to a trip in one all-or-nothing call. `app.archive_import --trip-id`
  completes an existing trip with only the records it lacks, and `--dry-run`
  reports what is present and what would be created.
  ([#182](https://github.com/tjorim/travel/issues/182))
- Video derivatives now transcode to a capped H.264/AAC MP4 with telemetry and
  container metadata removed. A separate WebP poster accompanies each video;
  the owner can remove audio, review the copy, retry failures and explicitly
  approve it before sharing. Visitor playback supports byte ranges, and
  offline pinning shows the copy size. ([#177](https://github.com/tjorim/travel/issues/177))
- Areas now have generalized dots seeded from a location's coordinates, and
  owner-only coordinate suggestions find a nearby area or propose a new one
  with a time zone. The owner map can show a hollow derived dot from private
  locations and save it on request. Route lines and the route editor use area
  dots. Focusing an area frames its own dot and all its location dots without
  storing a radius. Visitor projections expose only stored dots of shared areas.
- Google Photos can be connected from Instellingen with OAuth consent and PKCE.
  Access and refresh tokens persist encrypted in the application database,
  access tokens refresh during imports, and disconnect revokes Google's token.
  Providers without complete server credentials remain hidden. The
  `provider_secrets` table is created by the not-yet-deployed revision 001.

### Changed

- Third and last pass of the final layout check (#292). On a phone, every
  button, trip section tab, planning jump link, editor toolbar button, combobox
  toggle and map zoom control is now at least 44 px, dialog buttons included;
  desktop sizes are unchanged. A failed provider status on the Settings page
  offers a Try again button. The trip, emergency-information and packing
  template delete confirmations were opened and checked on a phone.

- Second pass of the final layout check (#292) in Dutch and English at 390 px
  and 1280 px, with a 23-route, 18-visit trip, a packing list, a published
  trip and a share link. Long trip titles on the public and unlisted pages now
  use a smaller, looser heading instead of filling the first screen with tight
  display lines. Travel update counts and the share link history label follow
  the selected language instead of always reading Dutch, a failed trip list no
  longer claims the account has no trips, the location editor no longer has a
  Cancel button that skipped the discard prompt every other editor shows, and
  the packing flag and template checkboxes are full-height rows on a phone.

- Final layout pass over the owner PWA and the public and unlisted views at
  1280 px and 390 px, with the Taiwan import, an empty trip, long titles and
  dark theme (#292). Language and appearance now share one row inside each page
  shell, aligned with the content instead of a 1000 px strip above it. The phone
  navigation links are full-height touch targets, Settings uses the same page
  header as the other owner pages, fieldset titles read like field labels, the
  native file picker and packing inputs use the standard controls, route
  summaries stay left-aligned on phones, destructive triggers are outlined so
  only their confirmation is solid, and unbroken long words in titles wrap
  instead of scrolling the page sideways.

- Video derivative jobs now run one at a time, so the worst case is a single
  ffmpeg process plus the API inside the container's memory limit. Queued jobs
  stay "processing" without being expired as stalled; the stalled clock starts
  when a job gets its slot (#305).

- Time zone suggestions use a Base UI Autocomplete instead of the browser's
  `<datalist>`; typing any zone still works. Form labels, errors and
  fieldsets use Base UI-backed `Field` and `FieldSet` components, so labels,
  error messages and validity are wired to their controls.
  ([#264](https://github.com/tjorim/travel/issues/264))

- Owner, public and unlisted views now use Tailwind utilities and named Travel
  theme tokens for their application styling. The legacy class allowlist is
  removed; Tailwind's base layer handles document and form defaults, and the
  remaining stylesheet covers sanitized Markdown. Buttons, inputs,
  checkboxes, textareas, disclosures and packing progress use Base UI
  primitives with Tailwind styling. Desktop and mobile layouts retain the
  existing visual identity.
  ([#264](https://github.com/tjorim/travel/issues/264))

- Shared record editors now use Base UI Dialog, with Base UI Alert Dialog for
  discard and delete confirmations. Their presentation uses Tailwind theme
  values, retains the mobile sheet, and guards Escape, outside presses, and
  close buttons when there are unsaved changes.
  ([#264](https://github.com/tjorim/travel/issues/264))

- Transport booking badges count non-cancelled routes with a departure day,
  including journeys without exact times, while leaving undated map routes
  out of booking progress. ([#248](https://github.com/tjorim/travel/issues/248))
- The private overview (`/admin/trips/:tripId/details`, "Volledig
  privéoverzicht") is now scannable: it opens with the trip's booking-status
  badges and route map, a section jump-nav, and human-readable status/kind
  labels instead of raw enum values (`planned`, `booking`, `photo`). Each
  record links straight to its dialog in the trip workspace, so an owner no
  longer has to leave and re-find it. Reisupdates show the saved visitor
  `body` next to the private note, no longer only the private note, and a
  saved location's own name is no longer repeated after itself (`Lisbon · PT`
  instead of `Lisbon, ... · PT · Lisbon`). The page still explains no
  implementation detail. ([#213](https://github.com/tjorim/travel/issues/213))
- The owner PWA and visitor views route with `@tanstack/react-router` instead
  of `react-router-dom`, matching the TanStack Query/Form foundation the app
  already uses. This swaps the routing library only: no loaders, type-safe
  search-param schemas or other new capabilities are adopted here, and the
  owner (`/admin`), public (`/trips`) and unlisted (`/share`) route trees,
  deep links and `/trips?new=1`/agenda-jump-nav entry points keep working
  unchanged. ([#221](https://github.com/tjorim/travel/issues/221))
- The MCP server uses layered tool discovery, like Worktime, Champagnefestival
  and Daynest: clients list only `whoami`, `list_trips`, `get_trip_overview`,
  `search_tools` and `call_tool` instead of all 94 tools (~35k tokens of
  schemas loaded into every conversation). `search_tools` ranks the catalogue
  with BM25 and returns up to five tools with their input schema, `effect` and
  `requires_confirmation`; `call_tool` runs one with unchanged validation,
  confirmation and auditing, and an audit row or error names the inner tool
  once rather than the proxy. An unknown name given to `call_tool` is a clear,
  logged error pointing at `search_tools`. Tool descriptions were tightened so
  English and Dutch task phrasings find the right tool, and
  `/api/mcp/capabilities` adds the listed surface as `visible_tools`.
  ([#196](https://github.com/tjorim/travel/issues/196))
- Every request body and MCP tool argument now rejects a field it does not
  define instead of dropping it. A misspelled or guessed field, or one a client
  cached from a newer or older schema, now fails with a 422 or a tool error that
  names the field, rather than succeeding without storing anything.
  Input models share one strict base, and a test walks every REST body and MCP
  argument to keep it that way. The audit row for a refused MCP call records
  only the field path and error type, never the rejected value.
  ([#189](https://github.com/tjorim/travel/issues/189))
- A stay whose accommodation is not chosen yet takes just an `area_id`; all
  such stays in one area share its city-level location instead of each adding
  a copy, and clearing a stay's location returns it there. Moving a location
  to another area now carries the route ends and visits at it along.
  ([#182](https://github.com/tjorim/travel/issues/182))
- MCP `list_areas`, `list_locations`, `list_visits`, `list_stays` and
  `list_routes` return compact rows (ids and labels) by default; pass
  `compact=false`, or use the `get_*` tool, for the full records.
  `list_areas` also takes a `query` to find an area by name.
  ([#182](https://github.com/tjorim/travel/issues/182))
- Documents are always private, whether kept in the owner-wide library or
  attached to a trip. Removed document derivatives, their share controls and
  visitor delivery; deleting either document type now removes its stored file.
  Migration `001_areas_locations_routes` drops the retired twin table, removes old
  scope selections and queues its files for purge. ([#176](https://github.com/tjorim/travel/issues/176))

- The media import buttons and provider settings follow `GET /provider-tokens` availability: Google Photos needs server OAuth credentials and an encryption key; GoPro Cloud stays hidden pending its beta OAuth contract. An available but unconnected provider is disabled in imports with a pointer to Instellingen.
- Made the place vocabulary one set of words and dropped raw GPS tracks. An
  *area* (*gebied*) is a city or region and a *location* (*locatie*) is an
  address-level place, or just a city, filed under exactly one area. They are
  separate tables, endpoints (`/areas`, `/locations`), share kinds (`area`,
  `location`) and MCP tools, so every reference points at the right kind by
  construction. Every stay has a location and takes its area from it;
  reisupdates can link to an area (shared) and a location (private). The
  Gebieden section lists what belongs to each area. The application stores no
  recorded location data: there is no track upload, and photo coordinates stay
  private metadata.
- Made getting somewhere one record, the *route*: a travel mode (flight, train,
  bus, ferry, car, bike, walk or other) between two areas. Only the mode and the
  two areas are required; the exact locations, a schedule with time zones,
  carrier and service number, booking details, documents and a hand-drawn line
  (with movable points) are optional. Visitors see a route's areas, mode,
  schedule, carrier and line, never its stations or booking; the maps draw the
  line, or a straight one between the two areas, in a style per mode. The
  endpoints are `/routes`, the share kind is `route` and the projection has one
  `routes` list.
- Made a stop of the trip one record, the *visit* (*bezoek*): an area, or a
  location in one, with optional days, a start and end time (local at the visit,
  in the time zone of its area), a kind (free or work), private notes and a text
  for visitors. A visit is shared like everything else: its dates follow the
  chosen precision, and its time is private unless the owner ticks "Toon de tijd
  aan bezoekers" (and then only with full dates, with the area's time zone).
  The API is `/visits`, the share kind `visit`, and the projection has one
  `visits` list. The day plan is a read-only agenda over stays, routes and
  visits. Routes and visits pick their places with one grouped picker (areas
  with their locations nested), so a location and its area are one choice.
- Added migration `001_areas_locations_routes` on top of `000_baseline`. It
  splits `places` into `areas` and `locations`, gives every stay a location,
  merges transport legs and drawn routes into `routes`, turns route stages and
  day-plan entries into `visits` (an entry lands in the area of what it
  linked to, else in an "Unassigned" area; the "travel" kind and tentative
  flag are dropped), rewrites stored share scopes, hands the bytes of stored
  tracks to the purge job and renames the leftover `moment_*` constraints. It
  downgrades too, with routes that have no earlier form dropped. The archive
  import file has `areas`, `visits`, `routes` and stays with a `location`.
- Squashed the original 30 Alembic revisions into `000_baseline`, a
  baseline of the schema already deployed. Fresh PostgreSQL databases build
  directly from it; existing databases at the former `0030_spots_require_areas`
  head are stamped to the baseline without changing their tables or rows.
- Made saved private spots reusable from stay, transport and reisupdate
  editors. Selecting one sends only its existing reference, so a Brussels
  Airport can serve both legs and a corrected stay or endpoint never silently
  creates a duplicate. Spot and area views refresh after those records change.
- Gave every shareable record the same private / everyone / custom choice and
  dropped the twins that only restated a private record. One `visibility` on
  places, route stages, broad routes, stays, transport legs, reisupdates and
  approved photo and document copies decides who receives a record, set by one
  endpoint (`PUT /trips/{id}/visibility/{kind}/{record_id}`) and one reusable
  control that appears in each item's editor and in Delen, where both write the
  same field. A scope now lists only `custom` records and never names fields;
  each kind has a fixed allowlist. Places are shared as themselves: an area
  shows its label, region and point, and a spot (a monument, a hot spring) can
  be named and shared without its address ("Plekken delen"), with directions to
  its point. A stay is shared as itself, showing only its area and nights at a
  chosen precision, so the broad stay card is gone. A transport leg shows its
  endpoints on the map only when those places are shared. A photo attached to a
  reisupdate is delivered with it. Leaving `custom`, or deleting a record,
  withdraws it from every scope. The earlier `0027` migration made a clean break: stored
  scopes lose their listed items and every record starts private.
- Merged the private moment into the reisupdate: one record with a private part
  (notes, exact place, attached photos) and a shared part (title, text for
  visitors, date, area). Capture now creates a private reisupdate with your
  notes; you write the text for visitors later, and an update without it cannot
  be shared. Moments, their API and MCP tools, and the source-moment link are
  gone. The earlier `0028` migration turned each moment into a private reisupdate with the
  same id, so photos and day-plan links carry over.
- Made the reisupdate the only story record, end to end, as a clean break.
  Highlights are gone (model, API, MCP tools, editor and visitor section) and
  the moment excerpt is now the travel update (`travel_updates`,
  `/travel-updates`, the `travel_update` share kind, `update` on a photo and
  `updates` in the visitor document, with `#update-…` fragments). Who sees an
  update is its own Private / Everyone / Custom choice (`private`, `everyone`,
  `custom`): Private reaches
  nobody, Everyone reaches the public page and every hidden link, and only
  Custom updates are chosen per audience in Delen, without a field checklist.
  Leaving Custom or deleting an update withdraws it from every live scope, and
  delivery ignores a stale entry. Delen shows how many updates are Everyone
  or Private and offers just the Custom ones. The archive import file
  (`travel/archive-import@1`) now names them `travel_updates`, drops its highlights,
  and imports them as private updates. The earlier `0026` migration renamed the table and column, dropped the
  highlights and removes retired selections from stored scopes, so every
  existing update stays private until chosen otherwise; `alembic check` now
  runs in CI to prove the migrated schema matches the models, and the models
  declare three indexes the migrations already created.

### Added

- Allowed friends and family to follow an explicitly selected transport leg in
  public and hidden-trip views: its kind/status, carrier/service reference,
  city/country endpoints and schedule can be shared. Booking references,
  travel class, notes, documents and endpoint addresses remain owner-only. A
  selected broad route remains the sole authoritative map line; only without
  any selected route does a general line join shared broad city points without
  reading private endpoint geometry.

- Shortened the "Delen" page: the scope editors group shareable items by type
  in collapsed sections that show how many are chosen, with "Alles kiezen" and
  "Niets kiezen" per section, and the hidden-link editor only opens when a link
  is started or chosen. With many broad routes and places the page was several
  times taller than it now is.

- Moved the remaining record editors onto the same dialog pattern as the other
  trip managers: a "new" button opens the add form in a dialog, and a record
  opens a view dialog with edit and delete (in-app confirmation, unsaved-changes
  guard). This covers the day plan, broad routes and track upload, trip
  documents (with their redacted copies), media upload, the library documents,
  emergency info and the trip editor itself (`/trips?new=1` opens the new-trip
  dialog from the home page). Long day-plan steps stack under their text and no
  longer squeeze into a narrow column. On phones every trip manager does the
  same: list rows put their actions under the text, the "new" button sits under
  the section description instead of wrapping into a tall narrow button, and
  dialogs use the full width. The public publication scope and the media import
  and review workflows keep their inline forms; named share links use the same
  record dialog as the other trip entities. The deliberately different
  workflow boundaries for publication, media, Capture and Settings are
  recorded in [the editor-workflow decision](docs/decisions/104-editor-workflow-boundaries.md).
  ([#170](https://github.com/tjorim/travel/issues/170))

- Added local sign-in without Keycloak, aligned with champagnefestival and
  worktime: `TRAVEL_DEV_AUTH_BYPASS_TOKEN` authenticates a request bearing that
  exact token as a fixed development owner (startup refuses it outside
  `TRAVEL_ENVIRONMENT=development`), replacing the `X-Travel-Subject` header and
  `--dev-subject`. With the same token exported, `pnpm dev` proxies `/api` to
  the local API, authenticates it with the token and opens `/admin/` already
  signed in; the application code itself has no dev path.

- Added a TanStack Query and TanStack Form foundation to the owner PWA: one
  authenticated fetcher, subject-scoped query keys that never share a cache
  with the public or unlisted views, deliberate abort/401/offline/retry
  defaults, targeted invalidation and safe optimistic updates, and a shared
  accessible form editor contract (validation, dirty state, pending state,
  server errors, reset after success). The owner home, trip list and editor,
  trip overview and private tasks use it; the trip editor now opens with the
  selected trip's saved values. Devtools are opt-in in development
  (`VITE_QUERY_DEVTOOLS=1`) and never bundled for production. The remaining
  screens follow in [#165](https://github.com/tjorim/travel/issues/165).
  ([#161](https://github.com/tjorim/travel/issues/161))

- Moved the remaining owner PWA screens onto the TanStack Query and Form
  foundation: stays, transport, broad places, itinerary, route stages,
  highlights, excerpts, tracks, documents, media, publication, the library,
  emergency info, settings, capture, the trip map and the trip detail page.
  No owner screen calls `fetch` itself any more: JSON, multipart uploads and
  protected file downloads all go through `ownerRequest`/`ownerFile`, and
  downloaded files are never stored in the query cache. Editors use
  `useRecordForm` with the dialog's unsaved-changes state, and the
  `revision`/`onChange` refresh props are replaced by query invalidation, so a
  saved or deleted record is never shown stale. Owner-managed share-link URLs
  remain only in the owner-only in-memory cache; provider tokens and previews
  are dropped from the mutation cache once settled.
  ([#165](https://github.com/tjorim/travel/issues/165))

- Extended owner-selected, encrypted offline copies to private media,
  individual itinerary entries and GeoJSON map/route snapshots. Each resource
  has owner-scoped revalidation; map tiles are deliberately not cached, in
  accordance with provider terms. Deleted media and itinerary entries also
  remove their local copy immediately. ([#131](https://github.com/tjorim/travel/issues/131))

### Changed

- Replaced the owner-facing technical word “broad” with the job each record
  does: reusable places, ordered stops, routes on a map and stay summaries.
  The privacy-safe boundary remains enforced internally; creating any of these
  records still never makes it public.
  ([#171](https://github.com/tjorim/travel/pull/171))

- Reused the owner-only place lookup wherever an editor creates a place:
  general places, private stays and transport endpoints. A general-place result stays
  deliberately kilometre-rounded; a stay or endpoint retains its selected
  exact provider metadata and coordinates while remaining private. Every
  suggested field remains editable and nothing is saved until its record is
  saved. ([#171](https://github.com/tjorim/travel/pull/171))

- Replaced the route JSON textbox with a map editor: owners click general
  points in order, drag a point to correct it, see the resulting line and can
  remove or clear points. Every saved route also has a read-only map
  preview before editing. Map clicks are rounded to roughly 100 metres so the
  editor remains for deliberate routes, while JSON remains available only
  as an advanced import path.
  ([#171](https://github.com/tjorim/travel/pull/171))

- Named share links are now reusable owner-managed URLs: an active link can
  be opened and copied again whenever the owner edits it, without disrupting
  the people who already received it. The server continues to validate a
  separate verifier for anonymous visits, and revoking or rotating a link
  removes the old URL. Links created before this change cannot be recovered
  from their existing one-way verifier; rotate one once to make it reusable.
  ([#171](https://github.com/tjorim/travel/pull/171))

- Rotating a named link now keeps its previous, revoked URL inside the same
  link history instead of presenting it as another independent link. Existing
  rotations are grouped from their audit trail during migration.
  ([#171](https://github.com/tjorim/travel/pull/171))

- The normal “Nieuwe link” flow now creates an active URL in one action. Its
  expiry is selected before saving, rather than making the owner create a
  confusing intermediate draft and activate it separately.
  ([#171](https://github.com/tjorim/travel/pull/171))

- Simplified sharing around the two records that actually control visitor
  access: a public page and named share links. Removed the superseded trip-level
  visibility, publication state and public-ID fields from the API, PWA and
  database, so they can no longer contradict a scoped publication. The sharing
  page now describes its choices in visitor terms, and explains date sharing as
  full dates, months only, year only or not shown. ([#171](https://github.com/tjorim/travel/pull/171))

- Replaced the last browser `confirm()` prompts in the owner PWA with the
  accessible in-app confirmation already used by the record dialogs: deleting
  a trip, document, medium, derivative, planning step, broad route, moment or
  emergency-info entry, disconnecting a provider, and removing offline copies.
  The confirmation is a modal with a focus trap, Escape and return focus, and
  states what will happen before anything is sent.
  ([#157](https://github.com/tjorim/travel/issues/157))

### Fixed

- Public trip pages link to the owner sign-in, and the owner dashboard links
  back to the public trip index.

- The complete private trip overview is now linked from every trip workspace
  and returns to that trip's workspace instead of the generic trip list.

- Switching a hidden-link editor no longer silently discards an unsaved name
  or scope, and revoking a hidden link now asks for in-app confirmation before
  invalidating it.

- "Alle reizen" (`/trips`) no longer stacks every manager of the first trip
  under the list, as it did before the workspace tabs existed: it only lists
  trips, and a row opens that trip's workspace. "Reis bewerken" moved to the
  workspace header, and deleting a trip returns to the list with its
  confirmation.
- Same-day Agenda items without an exact time no longer tie-break on their
  opaque record id, which could show a return route before its outbound leg
  or otherwise disregard a visit's explicit order. The tie-break was dropped
  in favour of each record's own order: a route by departure day/time/creation
  order (as the Routes list already shows it) and a visit by its explicit
  position. ([#206](https://github.com/tjorim/travel/issues/206))
- The Agenda moved to the top of the Plan tab with a jump-nav row to its other
  sections, and its rows now open the described stay, route or visit's own
  dialog instead of only reading its text; the owner no longer has to scroll
  back up to find and open the same record in another list.
  ([#208](https://github.com/tjorim/travel/issues/208))
- "Toon op kaart" on a day-plan step did nothing in the workspace, because the
  map only exists on the overview tab and the scroll target belonged to the old
  stacked page. It now opens the overview, scrolls to the map and focuses the
  point.

- Editing an existing record in a `useRecordForm` editor opened blank because
  TanStack Form re-applied its initial defaults after the record was loaded;
  the editor now keeps the loaded record as its baseline.
- Adding a second hidden share link now opens its editor, and the one-time
  link token stays visible after activation instead of being cleared at once.
- The publish button waits until the publication status has loaded.
- Removed the duplicate inline excerpt and broad-place editors from the trips
  page; the managers already provide both.

### Removed

- Removed the archive-authoring guidance now that `dist/` is retired and no
  longer deployed: the per-trip data contract, photo workflow and renderer
  sections of the README, `docs/media-assets.md`, and the unused Git LFS and
  derivative rules in `.gitattributes`. The static-page safety check became
  the app [publication safety check](docs/publication-safety-check.md).
  ([#40](https://github.com/tjorim/travel/issues/40))

- Removed the retired Go `travel-auth` session gate, its CI job, Dependabot
  entry and `travel-auth.env` setup. `compose.yaml` and `Caddyfile.example`
  now run the local app stack (Caddy, `travel-api`, PostgreSQL) with the same
  owner, public and unlisted routes as production; the archive is not served.
  ([#137](https://github.com/tjorim/travel/issues/137))

### Fixed

- Keep MCP invocation audit records and their trip identifiers after a trip is
  deleted. A failed audit write no longer reports a committed delete as a
  failed tool call.

- MCP tool failures now carry a correlatable request reference. A pydantic
  error raised while a tool runs (for example a stored row that fails its
  response schema) was reported as a misleading `-32602 Invalid request
  parameters`; it is now an actionable tool error. Calls refused before a tool
  ran, such as invalid arguments, are audited, and audit rows and log lines
  share the MCP request id. Neither logs nor audit details include payload
  values. The intermittent `-32603` failures on parallel list calls could not
  be reproduced (200 concurrent calls against PostgreSQL all succeed), so the
  cause is still unconfirmed and tracked in
  [#147](https://github.com/tjorim/travel/issues/147).

### Changed

- `GET /api/mcp/capabilities` now follows the shared MCP capability manifest
  contract (v1) used by all four apps: a top-level `contract_version`, and per
  tool `effect` (`read`/`write`), `requires_confirmation` and an `access`
  object (empty here, since Travel has a single owner-only policy). Tool
  authorization is unchanged, and a test checks that every registered tool's
  standard MCP annotations agree with its `effect`. MCP `destructiveHint` is
  now true for every tool that overwrites or revokes existing data (all
  `update_*` tools, `set_public_projection_scope` and `rotate_share_link`, not
  just `delete_*`/`revoke_*`/`unpublish_*`), and `openWorldHint` is true for the
  tools that call the place-search and media-import providers. The
  `inspect_public_preview_file` and `inspect_share_preview_file` tools, which
  only verify that a file is deliverable, are now reported as `read`.
  ([tjorim/apps#229](https://github.com/tjorim/apps/issues/229))

- Let an owner explicitly create a revocable unlisted share link without a
  natural expiry. Timed links still default to 30 days and remain capped at
  90 days; the UI warns that an unexpiring link is a long-lived credential.
- Automatically save successfully opened unlisted trips on the visitor's
  current browser and show them on its homepage, with a clear device-local
  warning and removal control. The server never receives a visitor index.
- Restored the owner PWA session after a refresh by silently exchanging the
  existing Keycloak SSO session for a fresh short-lived access token when
  browser session storage is unavailable. The access token remains
  session-scoped; persistent browser storage holds only a non-secret recovery
  marker, cleared on sign-out or expired SSO session.
- Numbered visitor route stages from one instead of zero.
- Retired the archive-only photo preparation helper and GeoJSON contract test
  as new trip content and media move to the application workflow.
- Replaced the static archive's three SVG route maps with a shared MapLibre
  renderer and separate public/private GeoJSON files, with provider attribution
  and accessible text fallbacks. ([#34](https://github.com/tjorim/travel/issues/34))
- Renamed the React source directory from `tracker/` to `frontend/` now that
  it serves owner, public and unlisted views; updated build automation and
  repository references.
- Renamed `api/` to `backend/` to house the shared application service as
  HTTP and owner MCP interfaces evolve; updated build paths and documentation.
- Revised the launch contract: create app content fresh, take the static
  `dist/` trip offline, and provide no archive import or old URL alias.
  Defined direct live route ownership and launch verification.
  ([#101](https://github.com/tjorim/travel/issues/101), [#89](https://github.com/tjorim/travel/issues/89))
- Removed the pre-launch `/api/published/trips/{public_id}` endpoint so
  browser delivery has only the scoped public and unlisted projection APIs.
- Renamed the owner PWA route from `/tracker/` to `/admin/`, including its build
  base, sign-in callback, manifest and service-worker scope.
- Moved application API routes from `/api/v1/*` to `/api/*`; the fresh launch
  serves no versioned URL alias.

### Added

- Added explicit trip-task reminder times, an owner-only alert inbox and an
  idempotent scheduled processor. Alerts can also be delivered by SMTP to an
  explicitly configured per-owner address. Due dates by themselves remain
  sorting metadata; travelers still check availability and make bookings.
- Gave cities and areas an optional IANA time zone (owner-only, editable) and
  used it with stays and flights to show where the plan puts the owner: the
  trip overview shows the live local time there and, before departure, the
  time difference at the trip's own dates, so a daylight-saving change such
  as Belgium's end of summer time (6 h → 7 h to Taiwan) is already reflected.
  Owner MCP tools can edit broad places.

- Added `app.archive_import`, an owner-run importer that recreates an archived
  trip through the API as a private trip, and the extracted Taiwan data in
  `dist/exampleland-2054/private/app-import.json` (flights, stays, day plan, tasks,
  route, highlights and story). ([#40](https://github.com/tjorim/travel/issues/40))

- Closed the remaining static-archive parity gaps. Stays are now nights
  (check-in date to check-out morning, optional local times) linked to a
  city or area, and can be planned before the accommodation is chosen. The
  day plan takes date ranges, a day kind and a concept flag, shows each
  night's stay, flags nights without one and can focus the owner map.
  Transport legs record each endpoint's time zone and a travel class, and
  show local times with the day shift. Tasks carry HTTPS reference links, and
  trips gain travel dates with live booking badges. Visitors can see
  owner-selected trip dates at a chosen precision, authored highlights and
  route-stage summaries, and owner MCP tools manage highlights like the
  other resources. ([#140](https://github.com/tjorim/travel/issues/140))

- Added a typed, owner-authenticated local MCP server with 104 task-specific
  management tools for canonical travel content, media/document workflows,
  previews, publication and revocable share links. Destructive and
  externally-visible actions require confirmation; MCP invocation auditing
  stores owner, action, resource and result without payloads or capabilities.
  When MCP/OIDC configuration is present, FastAPI mounts its stateless,
  authenticated HTTP surface at `/mcp` and exposes an authoritative capability
  manifest.
  ([#41](https://github.com/tjorim/travel/issues/41))

- Added scoped MapLibre maps to owner, public and unlisted trip views. The owner
  map parses finished private GPX/JSON tracks in memory and offers optional
  terrain and satellite controls; visitor maps use only selected broad points
  and routes. ([#119](https://github.com/tjorim/travel/issues/119))

- Added live public trip discovery on the Travel landing page and `/trips/`:
  only currently published, scope-approved titles and summaries appear, with
  no-store responses and visitor loading, error and empty states.
  ([#125](https://github.com/tjorim/travel/issues/125))

- Added an owner-only rendered preview for public and named-link publication
  scopes using the visitor components, with scoped preview files and navigation
  before activation and after withdrawal. ([#126](https://github.com/tjorim/travel/issues/126))

- Added live chronological visitor stories with stable moment links, authored
  dates at the selected precision, broad places, and responsive galleries of
  explicitly shared media derivatives. Owner controls now edit captions, alt
  text, focal position, and moment association; public and unlisted projections
  expose only selected presentation fields. ([#120](https://github.com/tjorim/travel/issues/120))
- Added owner-selected offline private copies to the React PWA: an explicit
  "Offline bewaren" toggle on library documents, trip documents and
  emergency-info entries pins a copy on the current device, encrypted with a
  per-owner AES-GCM key that is generated non-extractable and stored via
  IndexedDB where the browser supports it (with a clear in-app disclosure
  when it must fall back to an extractable key). Pinned copies carry a
  7-day access lease that is revalidated against the existing owner-only
  endpoints on every reconnect and purged if the source was deleted,
  unshared or no longer owned; no durable access token is stored with a
  copy. Pinning also requests persistent storage from the browser (with an
  in-app disclosure if it's declined) so pinned copies are less likely to be
  silently evicted under storage pressure. A new "Offline" section lets the
  owner inspect, remove or clear all pinned copies on the device, and
  signing out wipes the device key and every pinned copy. Frontend-only; no
  shared service-worker cache is used.
  ([#124](https://github.com/tjorim/travel/issues/124))

- Added an owner-wide document library and emergency-information page: an
  owner can upload, preview, download and delete reusable documents (a
  policy, an identity copy, other travel essentials) and manage emergency
  contacts, numbers and medical/assistance notes, all scoped directly to the
  owner subject rather than to any one trip, so neither needs a dummy trip. A
  library document can optionally link to an existing trip and appears there
  as a read-only reference. Both resources reuse the existing owner-only
  authorization and checksum-verified object storage pipeline, through a
  separate owner-scoped storage inventory, and are never projected onto a
  public or unlisted trip response.
  ([#123](https://github.com/tjorim/travel/issues/123))

- Added an owner day plan and booking task list for each trip: manually
  ordered itinerary entries that can optionally link to an existing stay,
  transport leg, route stage, exact place, document or moment (without
  copying any of that resource's fields), plus a lightweight trip task list
  with a due date and complete/incomplete state. Both are strictly owner-only
  and have no share-scope kind of their own.
  ([#122](https://github.com/tjorim/travel/issues/122))

- Added owner-managed flight and transport itinerary records: an owner can
  create, edit, order and delete outbound, return and connecting legs with
  departure/arrival exact places, times, carrier/service reference, booking
  status, notes and optional linked documents. Legs are owner-only and have
  no share-scope kind; a public/unlisted follower representation stays a
  separately authored route stage or broad route.
  ([#121](https://github.com/tjorim/travel/issues/121))

- Completed the application side of live public and unlisted trip delivery:
  server-filtered projections, visitor routes and publication lifecycle.
  Production routing followed in tjorim/apps#219. ([#73](https://github.com/tjorim/travel/issues/73))

- Rendered all scoped trip resource types in the live public and unlisted React
  views, including generalized route sketches, navigation markers, and
  approved media and document files delivered through scope-checked API routes.
  Added visitor component and API tests for sparse fields, fresh loads, scope
  changes and link revocation. ([#100](https://github.com/tjorim/travel/issues/100))

- Added data-free React visitor shells for `/trips/{slug}` and `/share/{token}`.
  Both fetch only their current scoped projection, show loading, empty,
  unavailable and retry states, and keep capability data out of browser storage.
  ([#102](https://github.com/tjorim/travel/issues/102))

- Defined the live owner, public and unlisted browser route contract, including
  scoped projection loading and uniform unavailable-link behavior. Public API
  projections now use `no-store` so the next load rechecks publication and
  scope; API tests cover anonymous projection delivery and unavailable
  capabilities. ([#103](https://github.com/tjorim/travel/issues/103))

- Owner-selected private-media visit review. The tracker groups a selected
  set into transient two-hour candidates, keeps GPS readings more than 500 m
  apart as visible owner choices, and leaves missing metadata out rather than
  guessing. A candidate can open a local, prefilled moment draft or attach
  its private media to an existing moment; reverse geocoding remains a
  separate explicit owner action, and no candidate, moment, place or share
  resource is created automatically. ([#97](https://github.com/tjorim/travel/issues/97))

- Private tracker PWA media management: direct photo/video upload, private
  original inspection and deletion, Google Photos/GoPro selection-session
  entry points, and metadata-free photo derivative generation, review,
  approval and deletion. Removing a derivative also immediately withdraws it
  from every live public or unlisted scope. The moment editor continues to
  keep attached media and EXIF suggestions owner-only and explicit. Settings
  now exposes non-secret provider connection status plus the temporary manual
  connect/revoke controls as the landing point for the OAuth work in #55; no
  token is returned to the browser. ([#98](https://github.com/tjorim/travel/issues/98))

- Owner-facing tracker controls for the public projection and named unlisted
  links. Each surface has a field-level `travel/share-scope@1` editor and
  server-rendered preview so an owner can inspect the exact delivered
  projection before publishing or sharing it. Named links can be created,
  edited, activated, revoked and rotated from the PWA. The raw capability is
  shown only from its activation/rotation response, kept only in component
  memory, and can be copied before the owner dismisses it; the app never
  fetches or persists it. ([#99](https://github.com/tjorim/travel/issues/99))

- Private tracker PWA management for ordered route stages, completed-track
  uploads and independently authored broad routes. Route stages select an
  existing broad place and can be reordered or removed without position
  conflicts. Track input is deliberately a finished GPX or JSON point-array
  file with bounded start/end times; the PWA contains no recording or
  background-location control. Raw files remain behind the authenticated
  owner endpoint, while broad-route lines are entered and saved separately
  from any raw track. ([#94](https://github.com/tjorim/travel/issues/94))

- Private tracker PWA workflows for creating, editing and deleting exact
  stays and separately authored broad-stay cards, plus uploading, viewing and
  deleting owner-only document originals. A redacted document copy must be
  uploaded with its redaction manifest, starts pending, and receives a clear
  explicit-approval action before it can be selected for a later share scope.
  File previews are fetched with the owner's authorization into a temporary
  browser object URL; the PWA does not put either originals or exact-stay data
  on a public or unlisted route. ([#95](https://github.com/tjorim/travel/issues/95))

- Private tracker PWA workflows for listing, creating, editing and deleting
  trips; capturing, editing and deleting canonical moments; and authoring,
  editing and deleting separately written moment excerpts. Exact places are
  searched or reverse-geocoded only through the owner-only OSM endpoints and
  are saved only after the owner selects and saves a moment; photo EXIF date
  and place suggestions remain separate, explicit actions. Broad places are
  authored without raw-coordinate entry and selected deliberately for an
  excerpt. Private media attachments, canonical moments, exact places and
  EXIF suggestions remain within authenticated tracker responses. ([#96](https://github.com/tjorim/travel/issues/96))

- Configurable, attributed owner-only OSM place search with a bounded
  in-memory confidential-query cache, durable OSM element type/ID references,
  and owner-selected display snapshots for exact places. Explicit reverse
  geocoding returns only a selectable candidate and never auto-creates a
  place, allowing a later owner-confirmed EXIF suggestion flow. Google Maps links are
  generated after owner or public/unlisted scope resolution: exact targets
  need an explicit `exact_place` navigation capability, while broad selected
  places only produce city-level destinations. Public and unlisted projections
  expose neither OSM references, coordinates, viewports, display snapshots nor
  direct Google URLs. ([#39](https://github.com/tjorim/travel/issues/39))

- Replaced the legacy public/unlisted route-stage and moment ID lists with
  the versioned `travel/share-scope@1` item allowlist. Public and unlisted
  projections now support explicitly selected route stages, broad places,
  broad routes, moment excerpts, broad stay cards, approved media derivatives
  and approved document derivatives, exposing only fields requested by the
  scope. Projection IDs are local to the response; originals, exact places,
  stays, raw tracks and unapproved/deleted derivatives remain unavailable.
  The accompanying data migration assumes no persisted production scopes and
  safely drops legacy moment selections, which cannot be represented by the
  share-safe moment-excerpt resource. ([#60](https://github.com/tjorim/travel/issues/60))

- Owner-managed `travel/document@1` originals and separately supplied
  `travel/document-derivative@1` redacted copies in the tracker API, with an
  Alembic migration and owner-only upload/list/delete/delivery endpoints.
  Every original, redacted copy and JSON redaction manifest is copied through
  the checksum-verified `StoredObject` pipeline. A derivative cannot reuse an
  original's bytes, begins in `pending` review, and requires explicit owner
  approval before a future share scope may use it; no public or unlisted
  document-delivery route exists in this phase. ([#59](https://github.com/tjorim/travel/issues/59))

- Owner-only `travel/recorded-track@1` and separately authored
  `travel/broad-route@1` resources in the tracker API, with an Alembic
  migration and owner endpoints. A complete GPX or JSON point-array upload
  requires bounded start/end times and is copied through the existing
  checksum-verified `StoredObject` pipeline; there are no partial, streaming
  or live-tracking endpoints. Raw track points and timestamps are retrievable
  only by the owner, never through public or unlisted delivery. A broad route
  stores an owner-reviewed GeoJSON line and date precision independently of a
  raw track, so shareable geometry is never derived at request time. Tests
  cover ownership, bounded uploads, and public-surface non-disclosure. Third
  of #38's seven delivery phases. ([#58](https://github.com/tjorim/travel/issues/58))

- Owner-managed `travel/stay@1` and separately authored
  `travel/broad-stay-card@1` resources in the tracker API, with an Alembic
  migration and owner CRUD endpoints. A stay retains its exact place, exact
  arrival/departure times, property, booking/contact details and notes behind
  the owner boundary. A broad stay card instead contains only an explicit
  broad place, title and date precision; it has no stay link, so it cannot
  disclose exact-place, date or booking data through a later projection.
  Authorization and no-leak regression tests cover both resource types.
  Second of #38's seven delivery phases. ([#57](https://github.com/tjorim/travel/issues/57))

- Split the tracker API's flat MVP `Place` into the canonical
  `travel/place@1` model: an `exact` place (address parts, coordinates,
  viewport, navigation/provider IDs, owner-only notes) or a `broad` place
  (label, country/region, optional approved generalized point), with an
  optional `parent_exact_place_id` for owner traceability that never appears
  in a shared response. A route stage now always references a `broad`
  place; a moment always references an `exact` place. Added the standalone
  `moment_excerpt` resource (`travel/moment-excerpt@1`) with owner
  create/edit/delete endpoints: `source_moment_id` is optional owner-only
  provenance, so an excerpt outlives a deleted journal item, and
  `broad_place_id` must reference a `broad` place on the same trip. Since a
  moment's place is now always `exact`, the public/unlisted projection no
  longer surfaces any place for a shared moment rather than leaking address
  or coordinate data. No production data exists yet, so the accompanying
  migration is a clean recreate of `places`, `route_stages` and `moments`
  rather than a data-preserving one. First of #38's seven delivery phases,
  per #37's canonical content model. ([#56](https://github.com/tjorim/travel/issues/56))

- Owner-only audit trail for the tracker API's publication and share-link
  lifecycle: an `audit_events` table records every public-projection
  publish/unpublish and every share-link create/activate/revoke/rotate, plus
  a link's natural expiry, with the link/projection id, owner action, a
  scope fingerprint, and an optional owner-entered reason. An event never
  stores a raw capability token, recipient identity, or recipient IP — a
  natural expiry (discovered on an anonymous request) is attributed to a
  `system` actor rather than the anonymous token holder. A new owner-only
  `GET /trips/{trip_id}/audit-events` endpoint reads a trip's history; a
  non-owner gets the same 404 as any other trip they don't own.
  `purge_expired_audit_events` (`backend/app/audit.py`) hard-deletes events past
  the sharing policy's 24-month retention window as pure application code,
  run manually for v1; recurring VPS scheduling is tracked separately.
  ([#48](https://github.com/tjorim/travel/issues/48))

- Durable, owner-only media ingestion for the tracker API: direct device
  upload as the always-available fallback, a Google Photos Picker session
  flow that imports only items the owner explicitly selected in Google's own
  UI, and a GoPro Cloud adapter behind the same provider interface, gated
  off by default until beta API access is granted so the product remains
  fully usable without it. Every imported or uploaded file is copied into
  Travel-controlled object storage and checksum-verified before it becomes a
  canonical `MediaAsset`; storage and import provenance both dedup per trip
  (`sha256`, and `provider`+`provider_item_id`), so retrying an interrupted
  import reattempts only the items that failed and never creates a duplicate
  record. Provider access tokens live only in a process-local secret store,
  never in the database or an API response. Originals and their raw
  EXIF/XMP/IPTC stay owner-only and are never modified on ingest; a
  best-effort read of each photo's capture time, camera and GPS is kept
  alongside the untouched original (`MediaAsset.captured_at` and
  `raw_metadata.exif`) so the owner can pre-fill a moment's date or place
  without re-parsing the file, preferring the file's own EXIF
  `DateTimeOriginal` over a provider's capture-time metadata when both exist.
  A stripped, resized derivative is generated only on explicit owner request
  and starts `pending` owner review, which is the gate a future share scope
  must satisfy before it can ever be projected publicly. Deletion is a soft
  delete honoring the 30-day recoverable-deletion policy, with a dedup-safe
  purge helper for objects nothing else references.
  ([#43](https://github.com/tjorim/travel/issues/43))

- Scoped, revocable public and unlisted publication links for the tracker
  API. Owners select an explicit scope (route stages, moments, optional
  title/summary) for the public follower view or a named unlisted link; both
  the scope and the content it selects are live, so adding, removing, or
  editing an item reaches visitors on their next request with no republish
  step, while an item outside the scope still never appears. What requires a
  deliberate owner action is only whether a page is served at all:
  publish/unpublish for the public view, activate/revoke/rotate for a named
  link. Named unlisted links use 256-bit
  owner-managed URL tokens with a separate keyed, one-way verifier for
  anonymous delivery and a 1-90 day (default 30) expiry;
  revoking or rotating a link invalidates its token immediately. Unlisted
  delivery responses carry
  `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive` and
  `Referrer-Policy: no-referrer`, including on a not-found/expired/revoked
  response. ([#42](https://github.com/tjorim/travel/issues/42))

- Versioned canonical-model and archive-publication design for the Travel
  application. It specifies owner-scoped content, files in backed-up VPS object
  storage, separate broad/derived share records, immutable public and unlisted
  projections, capability and static-export states, media-import records, and
  an earlier legacy archive migration proposal, since superseded by the
  fresh-launch decision. ([#37](https://github.com/tjorim/travel/issues/37))

- Versioned the Travel privacy, sharing and offline policy. It defines
  private-by-default public follower views and fine-grained named-share-link
  projections for every v1 resource, response redaction, capability lifecycle
  and revocation, device-scoped offline-copy behavior, and retention/encryption
  expectations.
  ([#36](https://github.com/tjorim/travel/issues/36))

- A reusable, data-driven local-route map component for private itineraries.
  It supports airport, stay and ground-route stops; road, rail, flight and
  mountain route styles; keyboard-selectable stops; and a textual route
  equivalent. Taiwan now supplies its local map through this component. ([#3](https://github.com/tjorim/travel/issues/3))

- Explicit, per-document offline saving for private documents. The root-scoped
  service worker is network-first and serves only manually saved local copies
  offline; the document list includes saved status, removal, and clear-all
  controls with an on-device storage warning. ([#4](https://github.com/tjorim/travel/issues/4))

- Git-native public photo workflow: Git LFS camera-original layout, a strict
  public media manifest with alt text, captions and focal points, responsive
  gallery/timeline-media components, and metadata-free WebP preparation.
  ([#9](https://github.com/tjorim/travel/issues/9))
- A repeatable public-route safety check for pre-deployment review of
  operational data, media GPS metadata, public/private file boundaries, and
  cache/indexing recovery after an accidental exposure.
  ([#10](https://github.com/tjorim/travel/issues/10))
- Privacy-first tracker MVP decision and FastAPI core for owner-scoped trips,
  route stages, moments, broad places, explicit publication, a read-only public
  endpoint, Alembic migration, and API tests. It has no media storage or GPS
  collection. ([#20](https://github.com/tjorim/travel/issues/20),
  [#22](https://github.com/tjorim/travel/issues/22))
- Installable React owner shell under `/admin/`, with isolated client-side
  refresh routing, accessible mobile navigation, empty account boundary, and a
  minimal app-shell cache. ([#21](https://github.com/tjorim/travel/issues/21))
- Authorization-code sign-in with S256 PKCE for the tracker, keeping access
  tokens in the browser session only and sending them solely to the tracker
  API. The account identity stays out of published-trip responses.
  ([apps#216](https://github.com/tjorim/apps/issues/216))
- Mobile moment capture in the tracker, with date/time and text editing,
  trip-level sharing visibility, locally queued drafts, honest offline status,
  and a deliberate broad-place choice. The optional browser location action is
  one-shot and immediately discards coordinates; it never sends or stores GPS
  data, and drafts are not automatically synchronized. Moments can also have a
  saved place removed while editing. ([#23](https://github.com/tjorim/travel/issues/23))

- Native server-side login and logout flow for shared and per-trip private
  routes, with short-lived signed secure sessions, Argon2id secret handling,
  Caddy forward-auth configuration, and central-infrastructure deployment.
  ([#11](https://github.com/tjorim/travel/issues/11),
  [apps#214](https://github.com/tjorim/apps/issues/214))
- Trip-specific private document-library route and `manifest.json` convention
  for Exampleland 2054.
- Per-trip `public/trip.json` and protected `private/trip.json` contract,
  documented in the repository and implemented for Exampleland 2054.
- Reusable trip-story and private trip-header components that load data from
  their corresponding static content files. ([#6](https://github.com/tjorim/travel/issues/6))
- Versioned public and private trip-data schemas, reusable card/timeline/
  booking renderers, and a small data-driven reference trip. ([#2](https://github.com/tjorim/travel/issues/2))
- Public, mobile-first Taiwan travel timeline with stable per-moment fragment
  URLs, rendered solely from the deliberately selected `public/trip.json`
  content. ([#7](https://github.com/tjorim/travel/issues/7))
- Public route/places map with full, city-level and no-map modes, public-data
  safety guidance, route stages and a visible textual route equivalent.
  ([#8](https://github.com/tjorim/travel/issues/8))

### Changed

- Document listings now display the document's trip association alongside its
  type, validity date and description.

### Fixed

- The owner Account menu no longer shows open on every page: Tailwind's preflight is not imported, so
  utilities such as `grid` overrode the `hidden` attribute of closed collapsible panels. It also sits
  at the right edge of the header instead of mid-page or, on phones, at the left.
- The trip header shows dates like "16 nov 2026" instead of ISO dates. Optional-field hints sit beside
  their label, so mixed required and optional fields line up, and the Reisupdates and Nog te regelen
  cards align. Plain fieldsets get the rounded, light border used elsewhere.
- A stay needing a place reports it on the Plaats field, which takes focus, instead of a banner at the
  foot of the form. The stay editor names the location a stay is already linked to and warns, without
  blocking, when the nights overlap another stay. A stay without a street address no longer shows a
  stray leading dot in its detail.
- Stays and routes no longer carry a red delete button on every row; deleting stays in the detail
  dialog, as with visits. The visit row actions (map, offline, up, down) carry the visit's name for
  assistive technology.
- The Settings page states once that no media provider is configured, and `/capture` opens over the
  trips overview instead of a blank page.
- Media review: the photo and capture time of a candidate are carried into "Als nieuwe reisupdate
  openen" (the already-mounted capture dialog ignored the hand-off). Capture times are read from the Exif
  sub-IFD where cameras write them, so real photos now yield candidates; the old lookup only worked for
  files written by test tooling.
- Uploads: an oversized document no longer ends in a server error. Trip documents, library documents and
  media answer 422 with a Dutch reason; the owner library now enforces the same size limit. Upload failures
  show inside the open dialog instead of behind it, as do refused deletes of every record type.
- Private originals are sent with `nosniff` and, unless the type is safe to display, as a download; the
  owner UI no longer renders an HTML or SVG file on the app's origin when opening it.
- Locations can be deleted (refused with the reason while a visit, stay, route or reisupdate still uses
  one), and the address that would be shared reads as words instead of raw JSON. Areas validate
  coordinates and time zones with Dutch messages.
- Routes report a missing or identical departure and arrival on the field, show a chevron on their
  disclosures, no longer print "minstens twee punten" for a line that has them, and no longer warn about
  duplicate option keys or a changing `defaultOpen`.
- The map labels areas in the style's own font (taken from the loaded style, Noto Sans by default) instead of
  MapLibre's built-in default, which the glyph server does not host and answered with a 404 on every load.
- Deleting a medium no longer triggers a read of its (now missing) copies, which answered 404 every time. A
  server error without a message now says the server is at fault, after naming what failed, instead of only
  the operation's fallback. The local dev server sends the same `/share/*` headers as Caddy (`no-store,
  private`, `no-referrer`, `noindex`); production Caddy in `tjorim/apps` already matched.
- Delen: "Alles kiezen" chooses every record that can be shared and names the ones that cannot, share
  links show their state in Dutch, and known API messages are translated.
- Packing lists sit in a card, use soft borders and a red over-limit warning, and the offline view has no
  stray bullets. Colourless `border` utilities use the divider colour, and the phone navigation stays above
  page content.

## 2026-09-21

### Added

- Static Exampleland 2054 public overview and protected detailed itinerary.
- Travel-hub landing page structured for future trips.
- Shared protected `/private/` area for general travel documents and emergency
  information.
- Git-backed document manifest and in-app native document preview component.
- Reusable international flight-map component with Taiwan AMS ↔ TPE flight data.
- Reusable travel-component directory at `dist/assets/travel/`.
- Public/private trip-data planning and implementation backlog.

### Changed

- Renamed the repository and apps submodule from `exampleland-2054` to `travel`.
- Expanded Caddy protection from only trip-private pages to both `/private/`
  and every `/<trip>/private/` route.
- Deployed `travel.tjor.im`; its public route is live and private routes are
  protected by the VPS-managed credential.
  ([#5](https://github.com/tjorim/travel/issues/5))
