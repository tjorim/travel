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
calendar feed and no GPX import in `backend/app/` or `frontend/src/`.

**Polarsteps** was read from its official website, news pages, help centre and
App Store listing. Each claim carries a source tag and its date. Two limits:

- `support.polarsteps.com` and one help-centre mirror returned HTTP 403 or 404
  to direct fetches. Help-centre claims (tag **H**) therefore rest on search
  summaries of those pages, not on a full read. Treat them as likely but not
  verified word for word.
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
| H1 | Help centre: [how the tracker works](https://support.polarsteps.com/hc/articles/24266585115026) and [offline use](https://polarsteps.helpscoutdocs.com/article/115-does-polarsteps-work-offline) | search summary, 2026-10-31 |
| H2 | Help centre: [who can see my trips](https://support.polarsteps.com/hc/articles/24267891448850) and [hide live location](https://support.polarsteps.com/hc/articles/34424572094482) | search summary, 2026-10-31 |
| H3 | Help centre: [Travel Together](https://support.polarsteps.com/hc/en-us/articles/24266937975570-Can-we-plan-a-trip-with-Travel-Together) | search summary, 2026-10-31 |
| H4 | Help centre: [export my data](https://support.polarsteps.com/article/124-how-can-i-export-a-copy-of-my-data) and [GPX import](https://polarsteps.helpscoutdocs.com/article/114-can-i-import-a-gpx-or-other-location-file-into-polarsteps) | search summary, 2026-10-31 |
| H5 | Help centre: [Travel Book price](https://support.polarsteps.com/hc/en-us/articles/24003935464466-What-is-the-price-of-a-Travel-Book), [Trip Reels](https://support.polarsteps.com/hc/en-us/articles/29738453341970-What-are-Trip-Reels), [travel statistics](https://support.polarsteps.com/hc/en-us/articles/33242544423954-Adding-countries-to-your-travel-statistics), [photos](https://polarsteps.helpscoutdocs.com/article/72-how-do-i-add-photos) | search summary, 2026-10-31 |

**Polarsteps in one paragraph.** A free, ad-free app (W, N1) with three jobs:
plan (itinerary, transport, web planning, an AI itinerary builder), track
(automatic background GPS route, steps with text, photos and video, stats) and
share (followers, privacy levels, Trip Reels, printed Travel Books). W claims
23M+ travellers; A lists a 4.9 rating from 10K ratings. Plus (EUR 8.99 a month or
EUR 29.99 a year, N1) adds 3D maps, more map styles, a play mode, more travel
buddies, elevation stats and 20% off Travel Books on the yearly plan.

**Size key.** S: one pull request. M: a few pull requests. L: several issues
and a design decision. XL: a new platform or a changed trust model.

**Ranking.** The owner's priorities decide the order inside table A: laptop
trip preparation first, then active trips, then visitors.

## A. Gap we want

Travel has no equivalent today and the feature fits the existing privacy
model, or fits it after a small decision. Order is by value for the owner.

| # | Feature | Polarsteps behaviour | Travel today | Recommendation |
|---|---|---|---|---|
| A1 | Trip statistics and planning-gap hints (laptop prep) | Countries, distance, days; a furthest-point figure; distance is an estimate and can be corrected by adding or deleting steps (H5). Elevation and transport-mode stats are Plus (N1). | The owner overview counts records per kind and warns about visibility problems (`backend/app/overview.py`). It does not say how many nights are covered, which nights have no stay, how many areas or countries the plan touches, or the distance per travel mode. | **Do first.** Owner-only, derived from existing stays, routes and areas, so no privacy decision. Distance can use the drawn line or the straight line between areas and is labelled approximate. Size S to M. No elevation (see B3). Needs no existing issue; track as a child of #94 once chosen. |
| A2 | Booking intake: confirmation to draft record | Forward a hostel, hotel or Airbnb confirmation to a Polarsteps address and it appears in the plan (N3, date unverified). In-app flight search adds flights to the itinerary (N2). | Stays, routes and documents are entered by hand. The owner's own assistant can already create them through the MCP `batch_create` and document tools (`backend/app/mcp_server.py`), but this is not a documented workflow and MCP is not yet routed in production ([apps#226](https://github.com/tjorim/apps/issues/226)). | **Do second, in two steps.** (1) Document an MCP recipe: paste or attach the confirmation, review the drafted stay or route, keep the original as a trip document. Size S, no new decision. (2) An inbound email address or an in-app paste box is a separate decision (D1): mail content is booking data, which stays owner-only, and an address needs VPS mail handling, which would be an issue in `tjorim/apps` once chosen. Size L. Flight search stays out (B6). |
| A3 | Owner data export | "Download my data" on the website: an emailed archive with steps, photos, routes (`locations.json`) and profile; no PDF export (H4). | No export of any kind. Backups exist on the VPS ([apps#220](https://github.com/tjorim/apps/issues/220)) but the owner cannot take one trip with them. | **Do third.** A per-trip owner download: JSON of records plus originals, derivatives and documents, streamed per #30 and read-only against the object-storage rules in [object-storage.md](../object-storage.md). The owner receives their own private data, so no visitor-boundary change. Size M. Also the base for A7. |
| A4 | Offline base map for an active trip | Tracking works with no connection and syncs later (H1); existing steps stay visible offline, adding spots needs a connection (H1). An offline map: **unverified**. | Opt-in encrypted offline copies of documents, media, itinerary entries, packing lists, emergency info and GeoJSON route snapshots, but map snapshots deliberately exclude provider tiles ([PLAN.md](../../PLAN.md) #131, [MAP-PROVIDER.md](../../frontend/MAP-PROVIDER.md)). Offline the owner sees the route as lines on no basemap. | **Do fourth, after D2.** Needs a tile source whose terms allow caching, a size cap and a device-scoped store under [decision 36](36-privacy-sharing-offline-policy.md) (short lease, wipe on sign-out). A self-hosted tile extract would need storage on the VPS and an issue in `tjorim/apps`. Size M to L. |
| A5 | Update feed for followers | Followers see new steps; a follow model with approval (H2). Whether followers get push notifications: **unverified**. | Visitors pull. The public page has stable moment links and a responsive disclosure of recent updates (pull request #89), but nothing to subscribe to. | **Public view only, after D3.** An Atom feed of what the public projection already shows needs no new data and no accounts. Never for a named link: a feed URL carries the capability into third-party readers. Size S. |
| A6 | Visitor-facing trip statistics | Stats unfold on the map for followers (W). | Visitors get an owner-selected map, story and galleries; no summary numbers. | **After A1 and D3.** A scope-selected "numbers" block (days, areas, countries, nights, never exact distances or times) added to the allowlist in [domain-model.md](../domain-model.md). Size M. |
| A7 | Printable trip book | Travel Book, a hardback made from published steps; needs 5 photos or more; price shown only at checkout; 10% off two, 15% off three or more (H5). | None. The visitor view is web only. | **Defer, then PDF only.** An owner-generated PDF from the same projection a visitor sees (or from the owner's own data) needs A3's streaming and a layout engine. Size L. Ordering prints from a vendor sends photos to a third party, which needs its own privacy decision (D4). |
| A8 | Trip replay or reel | Trip Reels: an auto-generated video, map flyovers added in 2026 (N2); needs about 10 photos; iOS first (H5). Play mode is Plus (N1). | None. There is a server video derivative worker ([media-worker.md](../media-worker.md)) but no reel. | **Lowest priority.** A client-side route replay on the existing MapLibre map is the cheap version (size M). A rendered video is not worth the worker cost for one owner. |

## B. Gap by design

Travel does not have these on purpose. Each row names the boundary and what
would have to change if the owner ever reversed it.

| # | Feature | Polarsteps behaviour | Boundary in Travel | If reversed |
|---|---|---|---|---|
| B1 | Automatic GPS route recording in the background | The core product: logs the route in the background with no connection, uses "typically less than 4% battery per day" (W), syncs later (H1). | [AGENTS.md](../../AGENTS.md): no GPS capture without an explicit product and privacy decision. [PLAN.md](../../PLAN.md): "The product stores no recorded GPS data, live or finished"; routes are drawn by hand. [domain-model.md](../domain-model.md): "the application stores no GPS tracks". | A new decision, then: a recorded-track record (the earlier `travel/recorded-track@1` was removed), owner-only raw points, and a reviewed generalised line as the only thing a projection may carry, per the Routes row of [decision 36](36-privacy-sharing-offline-policy.md). A web page cannot be relied on to record in the background, so this would also mean a native app or a companion. Size XL. Option D5(b) below is a smaller step. |
| B2 | Live location and "last recorded step" sharing | Followers can see the current location; the owner can hide it (H2). Summer 2026 added sharing a route only up to the last recorded step (N2). | [PLAN.md](../../PLAN.md): "no exact or near-real-time location is published automatically". Decision 36: no "live/near-real-time position" in any projection. | Depends on B1. Then a deliberate, expiring owner action with a fixed delay and a generalised point, on a named link only. Polarsteps itself had to add hide-current-location and hide-start/end options in 2026 after a press investigation (N4). Size L. |
| B3 | Elevation profiles, speed and step statistics from tracks | Plus: elevation gain and descent, elevation profile, transport modes (N1). | Decision 36, Routes row: "no track upload, timestamps, points, speed or elevation". Owner terrain is visual only ([MAP-PROVIDER.md](../../frontend/MAP-PROVIDER.md)). | Follows B1. Without tracks only a user-entered figure is possible. |
| B4 | Followers, follow approval, per-person audiences | A follower model with account-level approval, and trip levels Everyone, Followers, Only me (H2; W words them Only you, Friends & Family, The entire world). | Decision 36: "There are no viewer accounts, groups, invitations, recipient identities". [PLAN.md](../../PLAN.md): "There are no viewer accounts or sharing groups." The audiences are owner, public and named link. | A recipient identity and verification model, a revocation story per person and a notification path. The Keycloak invitation work in [apps#265](https://github.com/tjorim/apps/issues/265) is the likely base. A named link already serves a "family" audience without identity. Size XL. |
| B5 | Co-editing a trip (Travel Together) | Up to 5 travel buddies, 10 with Plus (H3, N1); buddies add, edit and remove steps and change the title and cover; one trip owner who alone removes people (H3). The help centre advises one editor at a time. | [PLAN.md](../../PLAN.md): collaborative editing needs a fresh decision. Decision 36: one account owner, no collaborative editing. Every query is scoped to `owner_subject`. | Multiple subjects per trip, roles, authorship in the audit trail (`backend/app/audit.py`), and conflict handling beyond the stale-write check from #15. Companions who only need to read the plan can get a named link today, but only at allowlist level: never booking data, documents or exact times. Size XL. |
| B6 | Booking and flight search inside the app | In-app flight search adds flights to the itinerary (N2). | `backend/app/task_alerts.py`: reminders are generic and "travelers check availability and make bookings". [PLAN.md](../../PLAN.md): generic external automation needs a decision. | A provider integration with its own keys, data sharing and terms. Not planned. |
| B7 | Social discovery, profiles and traveller tips | An Explore tab with trending places and places friends loved (N2), "traveler tips" (A). | [PLAN.md](../../PLAN.md): "further social Polarsteps-like features" need a fresh decision; public routes carry only deliberately published trips. | Needs B4 first and a moderation story. Not planned. |
| B8 | Built-in AI itinerary builder using past steps | Opt-in; analyses past steps to suggest an itinerary (summer 2025 release via search summary, **unverified** here; A lists an AI planner). | Judgment, not a stated rule: it would send trip history to a model provider, which sits under [PLAN.md](../../PLAN.md)'s generic external automation. The MCP tools are the supported route: the owner connects their own assistant, with confirmation on externally visible changes. | A privacy decision on what leaves the VPS and a provider contract. Not planned. |
| B9 | Public-by-default or account-wide profile sharing | Trips default to Followers; Everyone is one setting away (H2). After the press investigation Polarsteps reset all profiles to approval-required (N4). | [PLAN.md](../../PLAN.md): public default sharing needs a decision. New records are `private`; publication is an explicit action. | Not recommended. |

## C. Travel is ahead

| # | Area | Polarsteps | Travel | Where |
|---|---|---|---|---|
| C1 | Audience-scoped sharing | Three levels per trip; a secret link that bypasses the followers setting and can only be cut off by making the trip Only me (H2). I found no per-step privacy setting (**unverified**). | Every record is `private`, `everyone` or `custom`. A public view and any number of named links each list their own records, with a fixed allowlist per kind and the redaction done on the server. | [domain-model.md](../domain-model.md), [decision 36](36-privacy-sharing-offline-policy.md) |
| C2 | Share-link lifecycle | Secret links; Polarsteps expired all of them on 2026-08-20 and introduced a new way to create them (N4). | 256-bit capability tokens with only a keyed verifier checked, 1 to 90 day expiry or an explicit none, revoke, rotate, `no-store`, `noindex`, `no-referrer`, failed-token throttling (#46). | [decision 20](20-share-link-token-storage.md), `backend/app/capability.py` |
| C3 | Publication safety | I found no pre-publication review (**unverified**). Polarsteps removed photo location metadata from its API in February and August 2026 and home-town data from public trips (N4). | A written safety check, an owner-only rendered preview of exactly what an audience gets, a widening warning before a merge or location edit reaches visitors (#27, #32), and metadata-stripped, owner-approved photo derivatives. | [publication-safety-check.md](../publication-safety-check.md), `frontend/src/trips/RenderedPreview.tsx` |
| C4 | Audit trail | Not found (**unverified**). | Publication, link and live-scope events with fingerprints and no recipient data, kept 24 months, plus a payload-free MCP invocation audit. | `backend/app/audit.py`, `AuditEvent`, `McpAuditEvent` |
| C5 | Owner-only operational data | Not found as a category (**unverified**). | Stays, booking references, documents, emergency information, tasks and packing are never projected; the owner library is owner-scoped, not trip-scoped. | [AGENTS.md](../../AGENTS.md), `backend/app/library/service.py` |
| C6 | Offline use of what matters while travelling | Tracking works offline; adding steps and spots needs a connection (H1). | Opt-in, encrypted, device-scoped copies of documents, emergency info, media, itinerary, packing and route snapshots, with saved date, change flags on reconnect, a short revalidated lease and a wipe on sign-out. | [decision 261](261-packing-offline.md), `frontend/src/offline/` |
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
4. **Offline base map** (A4, M to L), only after D2.
5. **Public Atom feed and scope-selected visitor numbers** (A5 + A6, S + M),
   only after D3.

A printable book (A7) and a replay (A8) come after these.

## Open decisions

Each is a question for the owner. The recommended option is first.

**D1. How should booking confirmations enter a trip?**
(a) Documented MCP recipe only. (b) Plus an in-app paste or upload box that
drafts a stay or route for review. (c) Plus an inbound email address on the VPS
(needs a `tjorim/apps` issue). (d) Nothing; keep entering by hand.

**D2. What should work offline on the map during an active trip?**
(a) Nothing more than today. (b) Owner-selected region tiles cached on the
device, from a provider whose terms allow it. (c) A self-hosted tile extract on
the VPS (needs a `tjorim/apps` issue).

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
