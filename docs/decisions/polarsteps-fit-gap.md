# Polarsteps fit-gap analysis (#94)

[PLAN.md](../../PLAN.md) calls Travel "a custom Polarsteps-style application"
and lists collaborative editing, end-to-end encryption, continuous or live GPS
tracking, public default sharing, generic external automation and "further
social Polarsteps-like features" as needing a fresh product and privacy
decision. This page compares what Travel does today with what Polarsteps
publicly offers, so those decisions, and the smaller gaps that need none, are
made on evidence. It decides nothing itself: the owner answers the questions at
the end in [#94](https://github.com/tjorim/travel/issues/94).

Written 2026-10-31. Polarsteps changes quickly (its Plus tier is under four
months old), so re-check a row before acting on it.

## Method and sources

**Travel today** was read from code, not from older documents: the owner routes
in `frontend/src/router.tsx`, the workspace sections in
`frontend/src/trips/workspace-sections.tsx`, the models in
`backend/app/models.py`, the routers in `backend/app/routers/`, the MCP server
in `backend/app/mcp_server.py`, and the decisions under `docs/decisions/`. Where
code and `PLAN.md` disagree, the code wins. For example, `PLAN.md`'s history
still mentions an "explicit one-shot location action" and GPX track uploads;
there is no `navigator.geolocation` call anywhere and the track upload was
removed (the only GPS Travel reads is the EXIF position of a photo the owner
uploads, as an owner-only suggestion, see
[decision 297](297-exif-capture-time.md)). There is also no trip export, no
calendar feed and no GPX import in `backend/app/` or `frontend/src/`. The
owner PWA was also opened locally against synthetic data (development
sign-in, one private unpublished trip, nothing published or shared) to confirm
the overview badges, the "map tiles are not saved offline" notice and the
Sharing tab's per-item visibility, sharing check, hidden links and history.

**Polarsteps** was read from its official website, news pages, help centre and
App Store listing. Each claim carries a source tag and its date. Two limits:

- Server-side fetches of `support.polarsteps.com` returned HTTP 403, so a first
  pass rested on search summaries. Every help-centre article tagged **H** below
  was then read in full in a browser on 2026-10-31, which corrected the offline
  row (A4). Articles I could not open stay marked **unverified**.
- Anything not found in the sources is marked **unverified**. "Not found" is
  not "does not exist".

| Tag | Source | Date |
|---|---|---|
| W | [polarsteps.com](https://www.polarsteps.com/) home page | read 2026-10-31 |
| A | [App Store listing](https://apps.apple.com/us/app/polarsteps/id947925763), version 10.18.2 | read 2026-10-31 |
| N1 | [Polarsteps Plus launch](https://www.polarsteps.com/news/polarsteps-launches-polarsteps-plus-a-new-subscription-for-its-most-dedicated-travelers) | 2026-07-14 |
| N2 | [Summer 2026 release](https://www.polarsteps.com/news/polarsteps-launches-summer-2026-release-new-tools-for-planning-privacy-and-sharing) | 2026-06-09 |
| N3 | [Planning update](https://news.polarsteps.com/releases/planning-update-2025) | page metadata says 2026-10-15, URL and title say 2025: unverified |
| N4 | [Statement on the press investigation](https://www.polarsteps.com/comment-follow-the-money) | 2026-09-04 |
| V | Polarsteps web pages opened in a browser, logged out: the Travel Planner and Travel Tracker pages, a public profile and one public trip page linked from them (a 144-step trip; no personal details recorded here) | observed 2026-10-31 |
| V2 | Polarsteps web app, logged in as the owner, on a throwaway trip I created as "Only me", used and then deleted; the owner's real trips were not opened | observed 2026-10-31 |
| H1 | Help centre: [how the tracker works](https://support.polarsteps.com/hc/articles/24266585115026) and [offline use](https://support.polarsteps.com/hc/en-us/articles/24266379026066-Does-Polarsteps-work-offline) | read in full 2026-10-31 |
| H2 | Help centre: [who can see my trips](https://support.polarsteps.com/hc/articles/24267891448850), [who can see my location](https://support.polarsteps.com/hc/en-us/articles/38644843536018-Who-can-see-my-location-on-Polarsteps) and [hide live location](https://support.polarsteps.com/hc/articles/34424572094482) | read in full 2026-10-31 |
| H3 | Help centre: [Travel Together](https://support.polarsteps.com/hc/en-us/articles/24266937975570-Can-we-plan-a-trip-with-Travel-Together) and [trip owner and buddies](https://support.polarsteps.com/hc/en-us/articles/24266959407250-What-is-a-trip-owner-Travel-Buddy-and-trip-group) | read in full 2026-10-31 |
| H4 | Help centre: [export my data](https://support.polarsteps.com/hc/en-us/articles/24266264821138-How-can-I-export-a-copy-of-my-data) and [GPX import](https://support.polarsteps.com/hc/en-us/articles/24267546737426-Can-I-import-a-GPX-or-other-location-file-into-Polarsteps) | read in full 2026-10-31 |
| H5 | Help centre: [Travel Book price](https://support.polarsteps.com/hc/en-us/articles/24003935464466-What-is-the-price-of-a-Travel-Book), [Trip Reels](https://support.polarsteps.com/hc/en-us/articles/29738453341970-What-are-Trip-Reels), [creating a Travel Book](https://support.polarsteps.com/hc/en-us/articles/24267055732114-How-do-I-create-a-Travel-Book-of-my-trip) and [travel statistics](https://support.polarsteps.com/hc/en-us/articles/33242544423954-Adding-countries-to-your-travel-statistics) | read in full 2026-10-31 |

**Polarsteps in one paragraph.** A free, ad-free app (W, N1) with three jobs:
plan (itinerary, transport, web planning, an AI itinerary builder), track
(automatic background GPS route, steps with text, photos and video, stats) and
share (followers, privacy levels, Trip Reels, printed Travel Books). W claims
23M+ travellers; A lists a 4.9 rating from 10K ratings. Plus (EUR 8.99 a month or
EUR 29.99 a year, N1) adds 3D maps, more map styles, a play mode, more travel
buddies, elevation stats and 20% off Travel Books on the yearly plan.

**Visual comparison.** I opened Polarsteps' public web pages in a browser (tag
**V**) next to Travel's owner-side "View as visitor" preview, using a synthetic
local trip that stayed private and unpublished. Limits: the logged-in
Planner was then seen only on a one-destination trip (my attempt to add a
second destination clicked the wrong control, so how transport between
destinations is chosen on the web is **unverified**) and the phone app was not
seen at all; screenshots were low resolution and are not
committed because they contain other people's photos; the sandbox could not
load Travel's vector map style, so Travel's map showed its fallback and the
look of its map is not a fair sample. Observations of the public trip page (V):

| Aspect | Polarsteps public trip (V) | Travel visitor view | Verdict |
|---|---|---|---|
| Lead element | Photo and map first: a full-height sticky satellite map beside a scrolling timeline; a flag strip for the countries in the title; a "Now traveling, 666 days, 144 steps, 60,675 miles" chip on the map | Text first: a title with place names, a trip overview card and a map card, then a text timeline with an index of updates on the left | Polarsteps is more immediate. |
| Step card | A large horizontal photo strip per step (several photos, inline video clips), then the text, then a day, place, country, date and temperature line, like and comment buttons and "N others like this step" with names | A heading, date, place and text, then the update's photos as a gallery with captions (`ProjectionView.tsx`); my sample update had one photo, shown as a small thumbnail | Polarsteps shows more media at a glance and larger. Travel's gallery exists but the default presentation is quieter. |
| Map | Satellite basemap, a white route line and a round photo marker at every step, selected marker highlighted | Vector map with a route line, a keyboard list of points ("Points on the map"), a "route in words" fallback, 3D terrain, satellite and globe toggles | Polarsteps' photo markers carry the story; Travel's controls and fallbacks are better for accessibility. |
| Connections | "Traveled for 3 days" between steps; a "Trip started" start node | Dated, ordered updates | Cheap to copy: derived from dates. |
| Social | Likes and comments on each step, liker names shown to a logged-out visitor, a follower count, a Follow button on the profile, "Gift a Travel Book" and an app QR prompt | None, by design | See B4 and B7. |
| Weight | About 2,200 images in the page for 144 steps and about 13,000 for a long trip; my browser's screenshot timed out repeatedly on both trip pages | Not measured | Observation of one sample, not a benchmark. |
| Tracking by the site | A cookie banner offering third-party tracking; Reject All worked | Share routes load no third-party resource that could receive the URL ([decision 103](103-live-browser-route-contract.md)) | Travel is ahead (C3). |

So, visually Polarsteps is clearly ahead on photo presentation and map
storytelling, and Travel is ahead on restraint, accessibility and control. The
gap is mostly presentation of media Travel already holds, not missing data: see
A6b and A6c.

**Planner and trip settings (V2).** Polarsteps' web app creates a trip from a
name, a start date, an optional end date ("I don't know"), and a three-way
privacy choice: Only me, Followers (and anyone with the secret link) or
Everyone (and anyone with the link). The live-location and start-location
toggles are shown but can only be changed in the phone app (live location is
on by default, start location off). A new trip that overlaps an existing one is
refused ("This trip overlaps with ..., select a different date"); Travel does
not appear to impose that rule, though I did not test it. The planner is a list
of destination cards beside a satellite map: add by searching a place name or
coordinates or clicking the map; each card shows a photo, the dates, a "- 1
night +" stepper, a drag handle and an insert point between cards; two AI
buttons offer "Get a personalized itinerary" and "Refine itinerary". The
Travel Book page says weather, altitude and distances are added automatically,
and the web Track tab for a future trip tells you to use the app to track and
"get notified when they post", which confirms follower notifications exist
(A5). Sharing a private trip just offers to change its privacy level, and
deleting warns that photos, map locations, stories and comments go too. Compared
with Travel's Plan section the web planner is simpler and more visual (photo
cards, nights stepper, satellite map) but has no booking status, documents,
tasks, packing, idea or alternative states, or private/shared split per item
that I could see. Its stepper is the one interaction worth copying for a laptop
session (A1b).

**Organization and polish (V, V2 and code).** Measured in the browser with the
computed-style and Web Animations APIs, plus a search of Travel's source. These
are single samples, not benchmarks, and a screenshot cannot show motion, so the
timing is from measurement rather than from watching it.

| Aspect | Polarsteps | Travel | Verdict |
|---|---|---|---|
| Structure | Three modes in a left rail (Plan, Track, Travel Book) and three header actions (Share, Trip settings, Create Travel Book); the public trip is one scrolling timeline beside a sticky map; a profile has Trips and Statistics tabs | Six workspace sections (Overview, Plan, Prepare, Packing, Story, Sharing) with sub-blocks, a "Jump to" search, a sticky sidebar from 1100 px and a drawer below, breadcrumbs, and a separate owner library | Polarsteps is simpler and more guided; Travel is deeper but asks more of a new owner. |
| First run on an empty trip | "Plan your adventure now!" with two clear buttons, "Get a personalized itinerary" and "Build your itinerary yourself" (V2) | An empty overview with a nights badge, an empty updates card and "Nothing left to arrange"; no single suggested first step | Polarsteps is more inviting. |
| Hover and press feedback | 675 of the first 6,000 page elements transition: colour 0.2 s ease-in-out on 428, background 0.3 s on 110, opacity 0.2 s on 103 | 0 of 199 elements on the owner trip overview transition at rest; the source has a few `transition-colors` and `transition-transform` uses on cards and the accordion chevron | Polarsteps feels more responsive to the pointer. |
| Opening and closing layers | Not measured: the dialog I sampled turned out to be the cookie banner | The Capture dialog appears with no animation: over 280 ms its opacity goes from absent to 1 with no running animation (that window includes loading the lazy chunk). No `data-starting-style` or `data-ending-style` appears anywhere in `frontend/src`, so Base UI dialogs, the drawer and popovers have no enter or exit transition | Travel has none; Base UI supports them. |
| Loading | 225 skeleton or placeholder elements while the trip loads; 1,647 of 2,183 images are `loading="lazy"` | A pulsing skeleton, and a loader that fades in only after a 0.15 s delay so quick loads do not flash (`animate-travel-delayed-in`) | Comparable; Travel's delayed loader is a good detail. |
| Map motion | The timeline and map are linked: scrolling to a step highlights its marker and recentres the map (seen in two screenshots; easing not timed) | MapLibre `easeTo` (700 ms) and `flyTo` on selecting a point or toggling terrain, but they are all marked `essential: true` in `frontend/src/TripMap.tsx`, which makes them run even when the visitor asks for reduced motion; scrolling the timeline does not move the map | Polarsteps is livelier; Travel's map motion ignores a reduced-motion preference. |
| Reduced motion | Four `prefers-reduced-motion` mentions across 11 external stylesheets; one bundle also carries about 2,100 `@keyframes`, so I cannot say how much of it is guarded | The loader, the skeleton pulse and the accordion chevron carry `motion-reduce:` variants (`lazy-view.tsx`, `ui/skeleton.tsx`, `trips/SectionAccordion.tsx`); two `transition-transform` rules in `tailwind.css` and the map camera moves do not | Travel guards what it animates, apart from those and the map. Polarsteps unverified. |
| Keyboard focus | Not measured | A 3 px focus-visible outline on buttons, inputs, textareas and cards (`frontend/src/tailwind.css`) | Travel is likely ahead; Polarsteps unverified. |

Net: Polarsteps is more polished in feel (feedback on every control, linked
map and timeline, a guided empty state) while Travel is more orderly,
accessible and complete but static. The gap is cheap to close: see A9.

**Size key.** S: one pull request. M: a few pull requests. L: several issues
and a design decision. XL: a new platform or a changed trust model.

**Ranking.** The owner's priorities decide the order inside table A: laptop
trip preparation first, then active trips, then visitors.

## A. Gap we want

Travel has no equivalent today and the feature fits the existing privacy
model, or fits it after a small decision. Order is by value for the owner.

| # | Feature | Polarsteps behaviour | Travel today | Recommendation |
|---|---|---|---|---|
| A1 | Trip statistics and planning-gap hints (laptop prep) | Countries, distance, days; a furthest-point figure; distance is an estimate and can be corrected by adding or deleting steps. Countries count only once a step is placed there; a scratch map adds others by hand (H5). Elevation and transport-mode stats are Plus (N1). | The owner overview already shows booking badges: transport confirmed, nights confirmed with "n without a stay", and open tasks (`tripBadges` in `frontend/src/trips/TripOverview.tsx`), plus record counts per kind and visibility warnings (`backend/app/overview.py`). Missing: areas and countries the plan touches, days with nothing planned, approximate distance per travel mode, and any figure across trips. | **Do first, narrowed.** Extend the existing badges and overview with the missing numbers. Owner-only and derived from existing stays, routes and areas, so no privacy decision. Distance uses the drawn line, else the straight line between areas, and is labelled approximate. Size S. No elevation (see B3). Track as a child of #94 once chosen. |
| A1b | Nights stepper and drag-reorder in the planner | A "- 1 night +" stepper and a drag handle on each destination card, with an insert point between cards (V2). | Visits, stays and routes are edited in dialogs; visits carry a `position` but stays follow their dates, and the agenda is read-only (`frontend/src/trips/AgendaView.tsx`, `PlanSection.tsx`). | **With A1.** A quick nights adjustment and reorder on the owner Plan list for laptop sessions. Size S to M; keep the guarded-dismissal and stale-write rules. |
| A2 | Booking intake: confirmation to draft record | Forward a hostel, hotel or Airbnb confirmation to a Polarsteps address and it appears in the plan (N3, date unverified). In-app flight search adds flights to the itinerary (N2). | Stays, routes and documents are entered by hand. The owner's own assistant can already create them through the MCP `batch_create` and document tools (`backend/app/mcp_server.py`), but this is not a documented workflow and MCP is not yet routed in production ([apps#226](https://github.com/tjorim/apps/issues/226)). | **Do second, in two steps.** (1) Document an MCP recipe: paste or attach the confirmation, review the drafted stay or route, keep the original as a trip document. Size S, no new decision. (2) An inbound email address or an in-app paste box is a separate decision (D1): mail content is booking data, which stays owner-only, and an address needs VPS mail handling, which would be an issue in `tjorim/apps` once chosen. Size L. Flight search stays out (B6). |
| A3 | Owner data export | "Download my data" on the website: an emailed archive with steps, photos, routes (`locations.json`) and profile; no PDF export (H4). | No export of any kind. Backups exist on the VPS ([apps#220](https://github.com/tjorim/apps/issues/220)) but the owner cannot take one trip with them. | **Do third.** A per-trip owner download: JSON of records plus originals, derivatives and documents, streamed per #30 and read-only against the object-storage rules in [object-storage.md](../object-storage.md). The owner receives their own private data, so no visitor-boundary change. Size M. Also the base for A7. |
| A4 | Offline authoring that syncs later | Edit trips and steps, add photos to steps and write step text with no connection; everything syncs when the connection returns. iPhone syncs only while the app is open and unlocked. Adding new spots and activities needs a connection (H1). | One draft per trip is kept in `localStorage` (`saveDraft` in `frontend/src/tracker-model.ts`); the capture dialog tells the owner "offline drafts stay local, there is no automatic synchronisation" and the owner saves by hand once online. Offline copies are read-only. [browser-persistence-contract.md](../browser-persistence-contract.md) records Travel's model as explicit pins with no outbox. | **Do fourth, after D2.** The biggest active-trip gap. The smallest useful version is a per-owner outbox that replays only new reisupdates and their photos, serialised across tabs (the contract names Worktime's outbox as a model), keeps pending items on sign-out and never queues edits to shared records or visibility. Size L; it amends the browser-persistence contract. |
| A4b | Offline base map for an active trip | An offline map: **unverified**. | Map snapshots deliberately exclude provider tiles ([PLAN.md](../../PLAN.md) #131, [MAP-PROVIDER.md](../../frontend/MAP-PROVIDER.md)); offline the owner sees route lines on no basemap. | **After D2.** Needs a tile source whose terms allow caching, a size cap and a device-scoped store under [decision 36](36-privacy-sharing-offline-policy.md) (short lease, wipe on sign-out). A self-hosted tile extract would need VPS storage and an issue in `tjorim/apps`. Size M to L. |
| A5 | Update feed for followers | Followers see new steps; a follow model with approval (H2); the app notifies followers when someone they follow posts (V2). | Visitors pull. The public page has stable moment links and a responsive disclosure of recent updates (pull request #89), but nothing to subscribe to. | **Public view only, after D3.** An Atom feed of what the public projection already shows needs no new data and no accounts. Never for a named link: a feed URL carries the capability into third-party readers. Size S. |
| A6 | Visitor-facing trip statistics | Stats unfold on the map for followers (W). | Visitors get an owner-selected map, story and galleries; no summary numbers. | **After A1 and D3.** A scope-selected "numbers" block, also shown as a chip on the map and a flag strip in the header (days, areas, countries, nights, never exact distances or times) added to the allowlist in [domain-model.md](../domain-model.md). Size M. |
| A6b | Photo-led step cards | Several photos and inline video clips per step in a horizontal strip, a "Traveled for N days" connector, a temperature in the step header (V). | An update's approved photos render as a captioned gallery with a full-size view; loose photos follow their own visibility ([domain-model.md](../domain-model.md), `frontend/src/ProjectionView.tsx`). Presentation is a quiet thumbnail grid and there is no day connector. | **After A6.** A larger, photo-first presentation of that gallery and a connector derived from the dates, using only copies the audience already receives. Size S to M, no new data and no privacy decision. A temperature would need a weather service and a place point: skip. |
| A6c | Photo markers on the visitor map | A round photo marker at each step on the route, which is the main visual hook (V). | Visitor maps are built from the selected area points and routes only; no photos on the map (`frontend/src/TripMap.tsx`). | **After A6b.** Show a shared update's already-approved copy as a marker at its shared area. Same data the audience already gets, but a new thing on the map, so confirm in the publication check. Size M. |
| A9 | Motion and interaction polish | Colour and background transitions on most controls, a map that follows the timeline, skeletons while loading (V). | Almost no transitions; dialogs, drawer and popovers appear instantly; the map's camera moves ignore reduced motion, and the global `button` style has no transition; the map does not follow the timeline (see the polish table). | **Can ride along with any item above.** Add enter and exit transitions to the Base UI dialog, drawer and popover adapters with `data-starting-style` and `data-ending-style`, short hover and press transitions on shared buttons and cards, all behind `motion-reduce`; make the map's `essential: true` camera moves respect reduced motion; on the visitor timeline, recentre the map on the step in view. Size S for transitions and the map fix, M for the linked timeline. Record the adapter change in `docs/ui-components.md`. No privacy decision. |
| A7 | Printable trip book | Travel Book, a premium photo album generated from published steps, with route, statistics and stories; needs 5 photos or more; price shown only at checkout; 10% off two, 15% off three or more (H5). | None. The visitor view is web only. | **Defer, then PDF only.** An owner-generated PDF from the same projection a visitor sees (or from the owner's own data) needs A3's streaming and a layout engine. Size L. Ordering prints from a vendor sends photos to a third party, which needs its own privacy decision (D4). |
| A8 | Trip replay or reel | Trip Reels: an auto-generated video, map flyovers added in 2026 (N2); at least 10 published photos; up to 60 seconds, or 3 min 15 s when edited (H5). Play mode is Plus (N1). | None. There is a server video derivative worker ([media-worker.md](../media-worker.md)) but no reel. | **Lowest priority.** A client-side route replay on the existing MapLibre map is the cheap version (size M). A rendered video is not worth the worker cost for one owner. |

## B. Gap by design

Travel does not have these on purpose. Each row names the boundary and what
would have to change if the owner ever reversed it.

| # | Feature | Polarsteps behaviour | Boundary in Travel | If reversed |
|---|---|---|---|---|
| B1 | Automatic GPS route recording in the background | The core product: logs the route in the background with no connection, "typically less than 4% battery per day" (W), syncs later. Polarsteps calls itself "not a live tracker"; on iPhone it mostly uses WiFi and cell signals and takes GPS only from the OS (H1). | [AGENTS.md](../../AGENTS.md): no GPS capture without an explicit product and privacy decision. [PLAN.md](../../PLAN.md): "The product stores no recorded GPS data, live or finished"; routes are drawn by hand. [domain-model.md](../domain-model.md): "the application stores no GPS tracks". | A new decision, then: a recorded-track record (the earlier `travel/recorded-track@1` was removed), owner-only raw points, and a reviewed generalised line as the only thing a projection may carry, per the Routes row of [decision 36](36-privacy-sharing-offline-policy.md). A web page cannot be relied on to record in the background, so this would also mean a native app or a companion. Size XL. Option D5(b) below is a smaller step. |
| B2 | Live location and "last recorded step" sharing | By default followers see a live dot on the map (the toggle is on by default for a new trip); a Location privacy toggle hides the dot and the route since the last published step, and the whole route shows when the trip ends (H2). Summer 2026 added sharing a route only up to the last recorded step (N2). | [PLAN.md](../../PLAN.md): "no exact or near-real-time location is published automatically". Decision 36: no "live/near-real-time position" in any projection. | Depends on B1. Then a deliberate, expiring owner action with a fixed delay and a generalised point, on a named link only. Polarsteps itself had to add hide-current-location and hide-start/end options in 2026 after a press investigation (N4). Size L. |
| B3 | Elevation profiles, speed and step statistics from tracks | Plus: elevation gain and descent, elevation profile, transport modes (N1). | Decision 36, Routes row: "no track upload, timestamps, points, speed or elevation". Owner terrain is visual only ([MAP-PROVIDER.md](../../frontend/MAP-PROVIDER.md)). | Follows B1. Without tracks only a user-entered figure is possible. |
| B4 | Followers, follow approval, per-person audiences | A follower model with account-level approval, and trip levels Everyone, Followers, Only me (H2; W words them Only you, Friends & Family, The entire world). | Decision 36: "There are no viewer accounts, groups, invitations, recipient identities". [PLAN.md](../../PLAN.md): "There are no viewer accounts or sharing groups." The audiences are owner, public and named link. | A recipient identity and verification model, a revocation story per person and a notification path. The Keycloak invitation work in [apps#265](https://github.com/tjorim/apps/issues/265) is the likely base. A named link already serves a "family" audience without identity. Size XL. |
| B5 | Co-editing a trip (Travel Together) | Up to 5 travel buddies, 10 with Plus (H3, N1); buddies create, edit and remove steps and change the name, summary and cover; one trip owner who alone changes dates and privacy and removes people (H3). The help centre advises one planner at a time and a manual "Sync now". | [PLAN.md](../../PLAN.md): collaborative editing needs a fresh decision. Decision 36: one account owner, no collaborative editing. Every query is scoped to `owner_subject`. | Multiple subjects per trip, roles, authorship in the audit trail (`backend/app/audit.py`), and conflict handling beyond the stale-write check from #15. Companions who only need to read the plan can get a named link today, but only at allowlist level: never booking data, documents or exact times. Size XL. |
| B6 | Booking and flight search inside the app | In-app flight search adds flights to the itinerary (N2); the planner page lists finding stays through Booking.com, Airbnb and Hostelworld (V). | `backend/app/task_alerts.py`: reminders are generic and "travelers check availability and make bookings". [PLAN.md](../../PLAN.md): generic external automation needs a decision. | A provider integration with its own keys, data sharing and terms. Not planned. |
| B7 | Likes, comments, profiles, follower counts, social discovery and traveller tips | Likes with liker names and comments on every step, a profile with followers and country count, and a Statistics tab (V, H5). An Explore tab with trending places and places friends loved (N2), "traveler tips" (A). | [PLAN.md](../../PLAN.md): "further social Polarsteps-like features" need a fresh decision; public routes carry only deliberately published trips. | Needs B4 first and a moderation story. Not planned. |
| B8 | Built-in AI itinerary builder using past steps | Opt-in; analyses past steps to suggest an itinerary (summer 2025 release via search summary, **unverified** here; A lists an AI planner). | Judgment, not a stated rule: it would send trip history to a model provider, which sits under [PLAN.md](../../PLAN.md)'s generic external automation. The MCP tools are the supported route: the owner connects their own assistant, with confirmation on externally visible changes. | A privacy decision on what leaves the VPS and a provider contract. Not planned. |
| B9 | Public-by-default or account-wide profile sharing | Trips default to Followers; Everyone is one setting away (H2). After the press investigation Polarsteps reset all profiles to approval-required (N4). | [PLAN.md](../../PLAN.md): public default sharing needs a decision. New records are `private`; publication is an explicit action. | Not recommended. |

## C. Travel is ahead

| # | Area | Polarsteps | Travel | Where |
|---|---|---|---|---|
| C1 | Audience-scoped sharing | Three levels per trip; a secret link that bypasses the followers setting and can only be cut off by making the trip Only me (H2). I found no per-step privacy setting (**unverified**). | Every record is `private`, `everyone` or `custom`. A public view and any number of named links each list their own records, with a fixed allowlist per kind and the redaction done on the server. | [domain-model.md](../domain-model.md), [decision 36](36-privacy-sharing-offline-policy.md) |
| C2 | Share-link lifecycle | Secret links; Polarsteps expired all of them on 2026-08-20 and introduced a new way to create them (N4). | 256-bit capability tokens with only a keyed verifier checked, 1 to 90 day expiry or an explicit none, revoke, rotate, `no-store`, `noindex`, `no-referrer`, failed-token throttling (#46). | [decision 20](20-share-link-token-storage.md), `backend/app/capability.py` |
| C3 | Publication safety and visitor privacy | I found no pre-publication review (**unverified**). Logged out, the public trip page shows other people's names as likers and loads third-party tracking unless rejected (V). Polarsteps removed photo location metadata from its API in February and August 2026 and home-town data from public trips (N4). | A written safety check, an owner-only rendered preview of exactly what an audience gets, a widening warning before a merge or location edit reaches visitors (#27, #32), and metadata-stripped, owner-approved photo derivatives. | [publication-safety-check.md](../publication-safety-check.md), `frontend/src/trips/RenderedPreview.tsx` |
| C4 | Audit trail | Not found (**unverified**). | Publication, link and live-scope events with fingerprints and no recipient data, kept 24 months, plus a payload-free MCP invocation audit. | `backend/app/audit.py`, `AuditEvent`, `McpAuditEvent` |
| C5 | Owner-only operational data | Not found as a category (**unverified**). | Stays, booking references, documents, emergency information, tasks and packing are never projected; the owner library is owner-scoped, not trip-scoped. | [AGENTS.md](../../AGENTS.md), `backend/app/library/service.py` |
| C6 | Offline reading of what matters while travelling | Existing spots stay visible offline; Polarsteps documents no offline copy of booking documents or emergency information (**unverified**). | Opt-in, encrypted, device-scoped copies of documents, emergency info, media, itinerary, packing and route snapshots, with saved date, change flags on reconnect, a short revalidated lease and a wipe on sign-out. | [decision 261](261-packing-offline.md), `frontend/src/offline/` |
| C7 | MCP access | No public API or MCP found (**unverified**). | About 100 typed owner tools on the same validation as the app, BM25 tool discovery, confirmation for deletes and externally visible changes. Production routing is still [apps#226](https://github.com/tjorim/apps/issues/226), so today this is verified locally only. | [decision 196](196-layered-mcp-tool-discovery.md), [decision 336](336-mcp-resource-audience.md) |
| C8 | Languages | Interface languages: **unverified**. | Dutch and English across owner and visitor views, with an opt-in on-VPS draft translation of authored text. | [interface-translations.md](../interface-translations.md), [translation-drafts.md](../translation-drafts.md) |
| C9 | Planning depth for a laptop session | Planned steps, a transport planner and web planning since June 2026 (N2, N3). | Areas, locations with OSM search, visits, stays, routes with eight travel modes and idea, planned, confirmed, cancelled status, alternatives, a read-only day agenda, tasks with reminders, documents, packing lists with bags and templates, and merge tools with widening checks. | `frontend/src/trips/workspace-sections.tsx`, `backend/app/models.py` |
| C10 | Map terrain | 3D maps are Plus (N1). | Optional terrain and satellite layers for the owner map at no charge, with the viewer disclosure documented. | [MAP-PROVIDER.md](../../frontend/MAP-PROVIDER.md) |
| C11 | Cost and custody | Free core, Plus EUR 8.99 a month or EUR 29.99 a year (N1); ad-free and "we don't sell user data" (N1). | Single-owner, self-hosted, no tiers; data in the owner's database and object storage with backups in `tjorim/apps`. | [object-storage.md](../object-storage.md) |

**Parity, no action.** Steps with text, photos and video (reisupdates and media
with derivatives); a trip map with route lines coloured by mode; a timeline for
visitors with a chosen cover; a quick mobile capture with local drafts; photo
import from a cloud library (Google Photos Picker, GoPro Cloud, plus direct
upload) with EXIF time suggested, not applied.

## Recommended roadmap

At most five items, in order. Items 1 and 3 need no new decision; the rest
wait for the answers below.

1. **Trip statistics and planning-gap hints** (A1, S to M). Owner-only, from
   existing records.
2. **Booking intake, step one: a documented MCP recipe** (A2, S). Decide the
   inbound-mail step later (D1).
3. **Per-trip owner export** (A3, M). Portability and the base for any book.
4. **Offline authoring that syncs** (A4, L), and the offline base map (A4b),
   only after D2.
5. **Public Atom feed and scope-selected visitor numbers** (A5 + A6, S + M),
   only after D3.

A printable book (A7) and a replay (A8) come after these.

## Open decisions

Each is a question for the owner. The recommended option is first.

**D1. How should booking confirmations enter a trip?**
(a) Documented MCP recipe only. (b) Plus an in-app paste or upload box that
drafts a stay or route for review. (c) Plus an inbound email address on the VPS
(needs a `tjorim/apps` issue). (d) Nothing; keep entering by hand.

**D2. What should work offline during an active trip?**
(a) Nothing more than today (read-only copies, local drafts). (b) An outbox that
syncs new reisupdates and photos when online. (c) (b) plus region map tiles
cached on the device, from a provider whose terms allow it. (d) (c) with a
self-hosted tile extract on the VPS (needs a `tjorim/apps` issue).

**D3. What may visitors get beyond a page to open?**
(a) A public-view Atom feed and a scope-selected numbers block (days, areas,
countries, nights). (b) Only the feed. (c) Only the numbers. (d) Neither.

**D4. Should Travel produce a printable book?**
(a) Not now. (b) An owner-generated PDF only. (c) A PDF plus ordering printed
copies from a vendor, which means sending photos to that vendor.

**D5. Should any recorded location data ever enter Travel?**
(a) No; keep hand-drawn routes. (b) Only an owner-only, finished GPX import
that seeds a hand-drawn approximate line and then discards the raw points.
(c) Background recording in a native companion, with the reviewed-line rule in
B1. (c) is not recommended.

**D6. Should anyone besides the owner edit or follow as a known person?**
(a) No; named links stay the only audience. (b) A read-only plan link for
travel companions at the existing allowlist level, no new identity model. (c)
Invited co-editors, which means the multi-subject change in B5.
