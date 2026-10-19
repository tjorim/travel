# Owner route and workspace code splitting (#403)

The owner PWA used to ship every page and editor in one `admin` entry. It now
loads the shell, router, query client and the home and sign-in pages up front
and fetches the rest when first used.

## Boundaries

- `src/App.tsx` keeps the route tree, `createTrackerRouter` and the query client
  eager, so router and query-client identity, route loaders (`tripsRoute`
  prefetch), auth and URL state never depend on a chunk. Only the page
  components are deferred: Trips, TripWorkspace, TripDetail, Capture, Library
  and Settings. `Callback` (sign-in return) and `OwnerHome` stay in the entry.
- `Boundary` (navigation, account menu, preferences) stays eager. A deferred
  page renders in place of its component, so navigation remains usable while a
  view loads or fails.
- `src/pages/Trips.tsx` keeps the overview, the trip header and the trip and
  capture dialogs. The Plan, Story, Packing, Media and Sharing tabs are
  deferred separately (`PlanSection`, `MediaSection`, `TravelUpdateManager`,
  `PackingManager`, `PublicationManager`). Wrapper-only splitting would not
  have helped because `Trips` imports every manager.
- `TripDetail` used to import label tables and `OwnerImage` from editor modules.
  They now live in `src/trips/labels.ts` and `src/trips/OwnerImage.tsx`, so the
  read-only overview does not retain editor graphs. Keep view-only code from
  importing `*Manager` modules.
- MapLibre stays a dynamic import; the map still loads when a map first renders.

## File organization

- `pages/` holds route components only. `Trips.tsx` is the trips list (also
  rendered behind `/capture`); `TripWorkspace.tsx` is the `/trips/:id[/section]`
  route and the workspace container (`TripWorkspaceView`), which owns the
  trip's editor, capture dialog, record-focus and notice state.
- `trips/workspace-sections.tsx` is the one list of workspace tabs: each entry
  has an id, label, icon, section component and the record kinds it hosts. The
  tab bar, the route's section check, the content and every "open this record"
  link (`sectionForRecord`, `sectionPath`) read it, and
  `workspace-sections.test.ts` fails if a record kind has no tab or two. To add
  a tab: add an entry (and a message, and a section component taking
  `SectionProps`); to move a manager to another tab: render it from the other
  section component and move its record kind between the entries' `records`.
  The e2e tab walk in `e2e/smoke.spec.ts` lists tabs by hand and needs the same
  edit. Record kinds themselves are in `trips/record-focus.ts`.
- The workspace's own pieces live in `trips/`: `WorkspaceHeader`,
  `WorkspaceTabs`, `WorkspaceOverview`, and the section components
  (`PlanSection`, `StorySection`, `PackingSection`, `MediaSection`,
  `SharingSection`), loaded lazily by the registry. `trips/trips-status.ts` is
  the shared "loading your trips" message.
- `MediaManager`, `PublicationManager`, `PackingManager`, `RouteManager`,
  `StayManager`, `VisitManager`, `LocationManager`, `AreaManager` and
  `CaptureDialog` keep their public entry points and tests, and delegate to
  feature folders (`trips/media/`, `trips/publication/`, `trips/packing/`,
  `trips/routes/`, `trips/stays/`, `trips/visits/`, `trips/locations/`,
  `trips/areas/`, `trips/capture/`): data hooks for the owner API calls and
  catalogs, section components that take explicit props, and dialogs. The
  manager keeps the state those pieces share. Add new sub-views to the folder,
  not to the manager. In the place, route, stay and visit folders `model.ts`
  holds the form values, validators and pure helpers, `*Details` is the
  read-only dialog view and `*Form` the editor's fields. The route, stay, visit, location and area hooks wrap
  `trips/use-record-mutations.ts`, which holds their shared save and delete.
  `CaptureDialog` keeps the
  draft state and delegates the place lookup (`use-place-search`) and the
  photo list (`use-capture-media`) to hooks. `EmptyState` is in
  `ui/`.
- `pages/TripDetail.tsx` is the read-only complete overview: `trips/detail/`
  holds one block per record kind (`UpdatesBlock`, `VisitsBlock`, ...), the
  shared record links and `useTripDetail`, which reads everything the page
  shows. It shares no presentation with the workspace editors, whose rows are
  interactive; it must not import `*Manager` modules.

## Workspace tabs

Overview, Plan, Prepare, Packing, Story, Sharing, grouped by what the owner is doing:

- **Plan**: the timeline and where it happens: agenda, areas and locations,
  visits, stays, routes. An agenda row opens its stay, route or visit dialog in
  the same tab.
- **Prepare**: things to arrange and documents (with the library documents
  linked to the trip).
- **Packing**: the packing list, a large self-contained tool, so it has its own
  tab.
- **Story**: travel updates and the photos and videos that belong to them.
- **Sharing**: unchanged.

This replaced Plan (which also held the tasks), Packing, Story, and a Media and
documents tab that mixed bookings with photos. `/trips/:id/media` stays valid
and redirects to Story (`aliases` in the registry); an unknown section falls
back to the overview. The overview shows the next five open tasks as a
read-only card that links to Prepare; the task manager exists only there, like
the overview's travel-updates card and the Story tab.

Tabs with several editors (Plan, Prepare, Story) show each as a collapsible
block (`SectionAccordion`) under a bar with its title and a count. Only the
first block starts open; blocks stay mounted while collapsed, so a draft or an
open dialog survives collapsing. A block expands and scrolls into view when the
URL names it (`/trips/:id/plan#stays`, which is how the overview's task card
links to Prepare), when the jump search picks it, and when a record it hosts is
asked to open its dialog (`use-open-sections.ts`). The wrapper owns the
element id; the managers carry none.

The "Jump to" search under the tab bar lists every tab and every block ("Plan ›
Stays") from the registry, so new tabs and blocks appear in it without further
work. It does not search records (visit or task titles); that would need the
trip's data and a result for each kind.

## Site-wide and trip-level pages

Two levels, kept apart:

- **Site-wide** (the nav): Home, Trips, Library, Settings. Home is the
  cross-trip start page (reminders, now and soon, recently captured) and links
  to Trips rather than repeating its actions. Library holds documents and
  emergency information that belong to no trip. "Overview" is not a site-wide
  name, so it only ever means a trip's own tab.
- **Trip-level** (inside `/trips/:id`): the workspace tabs, and the full
  summary page at `/trips/:id/details`, linked from the trip's Overview tab.
  A trip header shows Trips › the trip, and Trips stays highlighted in the nav.
  The library documents linked to a trip appear on Prepare under "From your
  library", with a link to Library.

Capture is an action, not a place, so it is a button in the header (floating on
phones) rather than a nav item. `capture-context.tsx` owns the one capture
dialog: inside a trip the button opens it locked to that trip, elsewhere it
asks which trip, and the media review hands it a candidate through the same
context. The form is fetched on first use. `/capture` still works as a link
target, because shared links use it.

## State

Tabs unmounted on switch before this change and still do; deferral does not
change unsaved-change behaviour. Per-trip remounting (`key={trip.id}`), dialog
focus requests (`recordFocus`, `location.state.openRecord`) and the
`useRecordDialog` guards are unchanged, because the focus request lives in
`Trips` and is handed to a section once it has loaded. Route search, history
state and direct links to a tab (`/trips/:id/plan`) work because the tab is
chosen by the URL, not by what has loaded.

## Loading and failure

`src/lazy-view.tsx` wraps each deferred component in a `role="status"`
loading card and a `role="alert"` recovery card, both localized
(`owner_view_*`). The loading card is a skeleton that fades in after 150 ms, so
a chunk that arrives at once never flashes it, and it does not animate under
`prefers-reduced-motion`. The recovery card has an icon and a primary reload
button. Only a failed module fetch (`ChunkLoadError`) is
caught; render errors still reach the boundary above. A browser remembers a
failed import of the same URL for the life of the page (verified in Chromium),
so importing again cannot recover. The only action offered is "Reload page",
which re-requests modules and never replays a write.

## Service worker and offline

`public/service-worker.js` now keeps fetched `/admin/assets/*` responses in
`travel-admin-assets-v1` (cache first, at most 200 entries, oldest dropped, only
`200` responses). Hashed names make cached entries safe across releases; a
retired chunk that was cached keeps an old tab working, one that was not cached
returns `404`, and the reload action fetches the current shell. The shell cache
is `travel-admin-shell-v5`, so activation removes `v4`. The worker stays scoped
to `/admin/` and stores no API response or token, which the visitor rules in
`103-live-browser-route-contract.md` require.

Offline availability, checked with a production build and the worker:

| Situation | Result |
| --- | --- |
| Shell and any view opened while online | Reopens offline |
| Chunk opened once, page reloaded offline | Loads from `travel-admin-assets-v1` |
| Chunk never opened, opened offline | Recovery message; not available offline |

So a deferred view is available offline only after the owner opened it online
on that device. Owner-selected offline copies (Library) are unchanged.

## Measurements

Production `pnpm build`, initial static JS is the entry's HTML script and
modulepreload closure (`pnpm bundle`; Vite's gzip level):

| | Before | After |
| --- | --- | --- |
| Admin initial JS, raw | 1280.70 kB | 494.54 kB |
| Admin initial JS, gzip | 380.33 kB | 161.80 kB |
| Admin initial files | 2 | 7 |
| Visitor initial JS, raw | 528.52 kB | 530.76 kB |
| Visitor initial JS, gzip | 172.48 kB | 178.16 kB |
| Visitor initial files | 2 | 13 |
| All JS, raw / gzip | 2876.24 / 815.35 kB | 2895.87 / 848.81 kB |

The owner entry drops by 61% raw and 57% gzip. The cost is a few kB of shared
chunk overhead: visitor entries gain 2.2 kB raw, 5.7 kB gzip and 11 smaller
module requests because code shared with deferred owner chunks is now split
out of the old shared chunk. These are build output sizes, not measured
transfer. The largest deferred chunks are MapLibre (unchanged), `Trips`
(156 kB), `PlanSection` (131 kB), `MediaSection` (49 kB) and
`PublicationManager` (47 kB).

`bundle-budget.json` sets the limits about 10% above these results;
`pnpm bundle:check` runs in the Frontend CI job after the build.
