# Polarsteps itinerary management and display comparison (#94)

Follow-up to the [desktop](polarsteps-fit-gap.md),
[Android](polarsteps-mobile-fit-gap.md) and
[standalone visitor](polarsteps-visitor-fit-gap.md) passes. Created the matched
fixtures on **2026-10-31**; completed the checks below on **2026-11-01**.
Public and unlisted viewing remain first, domain/data/storage second, owner
planning presentation after them. This analysis changes no application code,
sharing policy, schema or storage contract. Existing A/B/C/M identifiers remain
stable; the observations below refine them rather than creating duplicate gaps.

The main finding is that **Polarsteps has more planning depth than the first
pass established**: separate accommodation records with booking statuses and
dated, timed spots, grouped inside destinations. Travel already holds the
corresponding information, with reusable areas/locations and independent visits,
stays and routes. Its opportunity is to make that information easier to read
in context, for the owner and at the existing visitor allowlist.

## Method, dates and limits

Each observation uses the following evidence tags. Dates are observation dates,
not feature release dates. “Unverified” never means “absent”.

| Tag | Method and date |
|---|---|
| PW | Signed-in shared desktop browser, Polarsteps future planner. Created one synthetic trip on 2026-10-31, explicitly **Only me**, 1–8 June 2035. Added two destinations, two invented accommodations and one custom museum spot. Reopened and edited on 2026-11-01, including booking status, destination nights, keyboard reorder and transport selection. Final confirmed desktop viewport 1440 × 900 CSS px. No booking, email, AI request or social action. |
| PN | Owner-authorized Fairphone 6 / Android 16, signed-in native Polarsteps, through T3 device tools and agent-device 0.21.31. Disabled the tracker for this synthetic trip and saved on 2026-10-31; no recording experiment. On 2026-11-01 reopened the fixture, its destination, hotel editor and hotel/spot cards. Phone reconnection was authorized for the remaining display checks; no phone setting changed. App version unverified. |
| TW | Travel local Vite/API with the synthetic SQLite database reused from the mobile pass, development authentication supplied by Vite. Created the matched fixture and local public/named-link scopes on 2026-10-31. On 2026-11-01 restarted our own API on :8000 and Vite on :5173 after the earlier processes had ended; stopped no existing process. Used `TRAVEL_ENVIRONMENT=development`, a local bypass token and the reused SQLite/media paths. `uv sync --all-groups --frozen` passed. Browser owner Plan/Story, record editors and standalone visitor routes; DOM dimensions at actual 1280 × 800 and 390 × 844. English sampled; this follow-up does not repeat the full locale/theme matrix. |
| TN | Same physical phone, Chrome over LAN HTTP to the synthetic Vite instance on 2026-11-01. Inspected owner Plan/Agenda and scrolled the real public trip through map fallback, story, visit, areas, generalized stays and train/flight blocks. English, automatic appearance rendered dark. Android's web accessibility snapshot omitted the page controls, so current screenshots and coordinate swipes supplied display evidence. This is neither installed-PWA nor TalkBack evidence. |
| H | Local HTTP GETs of owner and public/unlisted projections on 2026-10-31 and rechecked 2026-11-01. Confirmed counts and absence of synthetic property/booking canaries. PW's private fixture opened logged out in an incognito browser on 2026-11-01: unavailable private-trip/profile shell, no fixture itinerary. No audience widened to obtain a positive Polarsteps visitor sample. |
| C | Current source and contracts read 2026-11-01: [domain model](../domain-model.md), [decision 36](36-privacy-sharing-offline-policy.md), `backend/app/schemas.py`, `projection.py`, `frontend/src/ProjectionView.tsx`, and owner files referenced below. Source is distinguished from interaction evidence. |

Evidence, local state and capability values stay outside Git. The resumed
session's state is under the user's local review directory; temporary evidence
from the preceding runtime is no longer available. No private or public trip
photographs, account identifiers, raw responses, capabilities or screenshots
are committed. Follow [source privacy](../source-privacy.md).

Travel's [publication safety check](../publication-safety-check.md) was applied
before **local synthetic publication only**: invented content, no addresses,
bookings, private notes or precise hotel locations in the projection. Both
public and unlisted return two areas, two stays, one museum visit, two routes
and two authored updates. Two additional private city visits remain absent.
Hotel/property names and booking canaries remain absent after edits (H).

The fixtures started alike, then deliberately diverged to observe edit
semantics. They are not a timed usability study. Polarsteps' synthetic trip
remains **Only me** for owner review; it was not published or deleted. Native
and desktop eventually showed the same reordered destinations and hotel/spot
cards, but sync latency was not measured. One earlier native connector still
showed Car after a desktop Train selection; this alone establishes no sync bug.
No real owner trip was edited.

**Flight limit:** PW reached the separate **Add a flight** flow and selected
Hualien (HUN) to Taipei Songshan (TSA). The departure picker on 2026-11-01
contained November 2026–November 2027, not June 2035 (the preceding day's
picker began October 2026). No dated service was saved. This is a fixture/search
horizon limit, not evidence that Polarsteps lacks flights or booking fields
elsewhere. Train selection in the destination connector was saved and observed;
Travel's independent train and flight records were both displayed.

## Corrections to the earlier passes

- **Desktop planning paragraph and C9:** “no booking status … that I could see”
  was an incomplete first observation. PW/PN directly establish separate stays,
  **Saved / Pending confirmation / Booked / Cancelled**, check-in/out dates,
  optional times, property/address/website/notes and booked-night progress.
  A museum spot has its own dates, time and notes. Do not claim exclusive Travel
  planning depth from not having opened a destination.
- **A1b and the Reorder task:** the destination nights stepper and Travel's
  accommodation nights stepper operate on different records. They are not
  semantically equal. Polarsteps also supports keyboard reorder: focus its
  handle, Space, Arrow Up, Space; instructions and live status were present and
  the saved destination order changed (PW, 2026-11-01). The earlier inference
  that its drag handle requires a pointer was wrong. Keep Travel's explicit
  buttons for their clarity, not an unestablished exclusive accessibility claim.
- **C5 and B5 field scope:** the earlier blanket “stays … never projected”
  and “never … exact times” phrasing was too broad. Stay area/nights and route
  schedules are allowed; visit time is opt-in. The private property/booking
  fields remain prohibited. This corrects description, not policy.
- **Mobile future-planning limit:** PW/PN now establish future destination,
  hotel and spot display and a web transport chooser. This narrows the earlier
  “unverified” scope; native flight search, forwarding and AI remain untested.
- **Visitor physical-browser limit:** TN now establishes actual Travel phone
  rendering for this small text-only itinerary. It does not complete M4's
  multi-photo, installed, performance, locale/theme or accessibility acceptance.
  The richer visitor fixture and its measurements remain separate.

## Record mapping: what is being managed

| Concept | Polarsteps observed (PW/PN) | Travel today (TW/C) | Consequence |
|---|---|---|---|
| City or region | Ordered destination with date range and number of nights; entry to its notes, stays and spots. | **Area** is a reusable generalized place, not a dated stop. A city **visit** supplies dates/order; many locations and records can use the area. `docs/domain-model.md`, `AreaManager.tsx`, `VisitManager.tsx`. | Retain the distinction. A destination-focused screen can derive its contents from records without making an area a booking or duplicating it for every visit. |
| Accommodation | A stay under a destination; independent check-in/out, optional times, booking status and notes. | **Stay** requires a location, inherits its area, has property/booking/contact/notes, dates and idea/planned/confirmed/cancelled states. `trips/stays/StayForm.tsx`, `StayList.tsx`. | Both have real accommodation planning. Match “Booked” with confirmed, not with planned nights. Travel's private location and property labels can differ. |
| Attraction or stop | Custom museum **spot** under a destination; date/time and notes. Supplier discovery cards appear below it. | Reusable **location** plus a dated/timed **visit**; museum visit can have independent visitor title/text, precision and time-sharing choice. `trips/visits/VisitForm.tsx`. | A spot is the closest observed equivalent, not proof of the same reuse or sharing model. No supplier discovery or provider data transfer is selected here (B6/B8). |
| Getting between cities | Adjacent-destination connector: mode, estimated distance and sometimes duration; separate flight-service search. | Independent **route**, two area/location ends, mode/status/day, optional schedule/time zones, carrier/service/class/booking/notes/documents and approximate line. `trips/routes/RouteForm.tsx`, `schemas.py`. | Distinguish estimated journey from scheduled service. The connector chooser did not expose a train service/booking form; other Polarsteps paths remain unverified. |
| What happened | Future Track view says to return when the trip starts to add photos/videos/stories. | Authored **reisupdate**, separate private notes and visitor text; not generated by creating a hotel or route. `trips/StorySection.tsx`, `ProjectionView.tsx`. | Planning information and story are different views. Showing safe itinerary context does not require converting bookings into authored narrative. |

## Matched edits and resulting display

Initial cities were Taipei 1–4 June and Hualien 4–7 June 2035 (three nights
each), hotels on those dates, museum 2 June and Travel train/flight on 4/7 June.
Times below are local Asia/Taipei unless explicitly stated otherwise.

| Action | Polarsteps result | Travel result | Interpretation |
|---|---|---|---|
| Add accommodation and museum | Custom name search offered Add when no result existed. Both synthetic hotels saved; museum row displayed 2 June, 15:00. Stay form offered four statuses and booking-site/forward-email entry points (PW, 2026-10-31; hotel/spot cards PN, 2026-11-01). | Two stays and private hotel locations; museum location and visit; owner Agenda combines stays, visits and routes (TW). | Both manage the information. Polarsteps makes destination membership prominent; Travel exposes reusable entities and a combined chronological view. No confirmation email sent. |
| Replace hotel name and mark booked | Renamed first property to Synthetic Replacement Hotel; Booked saved. Destination progress changed 0/3 to 3/3 nights booked. Native card displayed BOOKED, three nights and 1–4 June; opening it entered the editor (PW/PN, 2026-11-01). | Renamed first stay in its editor; linked private location retained its original name. Owner list/detail displayed the replacement property and private booking context (TW, 2026-11-01). | Compare property and location separately. Travel status controls were inspected but this fixture's stay was left planned; its nights stepper remains eligible only before sharing/confirmation. No equivalent timed booking-status task measured. |
| Add one night | Destination Taipei became 1–5 June; following destination shifted to 5–8 June. Existing hotel remained 1–4 and museum remained 2 June; booked progress became 3/4 (PW, 2026-11-01). | Private planned stay checkout became 5 June. Second hotel and 4 June train did not move; editor warned of overlapping stays (TW/H, edits 2026-10-31, rechecked 2026-11-01). | Polarsteps recalculates destination dates while preserving booking dates. Travel edits one accommodation. Neither action establishes a safe “shift all bookings” operation. |
| Reorder cities | Keyboard moved Hualien before Taipei: Hualien 1–4, Taipei 4–8. Taipei hotel stayed 1–4 and museum 2 June, now outside that destination range. Connector regenerated as opposite-direction Car, 97 mi / 3 h 2 m (PW, rechecked PN, 2026-11-01). | Added explicit city visits, then Move up changed Hualien's position before Taipei. Original visit dates, stays and route endpoints/times were unchanged (TW/H, 2026-10-31, rechecked 2026-11-01). | Travel's order is manual position, not itinerary rescheduling. A chronological Agenda may therefore retain its order. Both need conspicuous date/booking conflicts if offering broader rescheduling later. |
| Change museum time | Custom museum saved at 15:00 and displayed under Spots (PW creation 2026-10-31; PN recheck 2026-11-01). | Visit changed from 14:00 to 15:00, ending 16:00; owner Agenda showed it. Visitor displayed day/summary only because time-sharing was off (TW/TN/H). | Travel's time disclosure is an explicit boundary, not a missing owner time field. |
| Choose transport | Car, Train, Flight, Bus, Sailboat, Hike, Bike, Motorbike and Direct distance A to B appeared. Train saved as 73 mi with no observed duration. Different modes can supply different estimates (PW, 2026-10-31–11-01). | Eight modes: Flight, Train, Bus, Ferry, Car, Bike, On foot, Other. Separate train and flight rows show schedule, endpoints, carrier/service/status (TW/TN/C). | Names and capabilities differ; Sailboat is not verified as a ferry equivalent. Travel lacks computed routing/duration here; retain approximate drawn/straight-line semantics (B1/B3). |

## A. Gap we want — managing and reading context

S = one PR, M = several PRs, L = broader design. Recommendations are proposed
work tracked in #94, not implementation authorization in this documentation PR.

| Existing row | Polarsteps behaviour | Travel today and references | Recommendation, size and decision |
|---|---|---|---|
| M4 / A6b / A6c | Public story/photo/map behaviour is in the visitor supplement. Positive visitor exposure of this private itinerary is unverified (H). | Public/unlisted render selected story, then separate Visits, Areas and locations, Stays, Routes. Two updates do not explain the relation between these blocks. `ProjectionView.tsx`, `TripMap.tsx`; screenshots TN, DOM TW. | **Visitor first:** give approved visits/stays/routes readable context beside or within the relevant area/day, with clear mode/area labels and a compact route overview. Preserve omission/precision; do not invent a day for month-only stays. M; owner choice ID1 below, no policy change for existing fields. Coordinate #5/#98 rather than add another map system. |
| C9 / A1 | Destination opens into Stays and Spots with dates/status, plus separate planned-night and booked-night progress (PW/PN). | Initial Plan opens Agenda; Areas/locations, Visits, Stays and Routes are separate disclosures. Overview already has transport/nights confirmed and uncovered-night badges. `PlanSection.tsx`, `AgendaView.tsx`, `TripOverview.tsx`. | After visitor/domain review, offer a destination/visit-focused owner reading view over the same records, with dated stays and outgoing services. Keep global Agenda and records accessible. M; ID2. Extend A1's existing badges rather than add competing counts. |
| A1b / C9 | Destination night edits cascade destination dates; existing accommodations/spots stay dated. Reorder also regenerates a connector (PW). | Stay stepper changes one private idea/planned accommodation. Visits reorder without changing dates. `StayList.tsx`, `VisitList.tsx`. | Explain each action's scope; show date conflicts and affected bookings before any future cascade. S for scope/conflict presentation; L for rescheduling. ID3 before cascade; never silently shift confirmed bookings. Existing A1b remains delivered. |
| C9 / M0 | Hotel card carries status, nights and check-in/out together; native hotel opens directly in editor (PN). | List has dates/status; read-only stay detail shows name/place/booking/notes but no date/status summary. Visit Overnight text joins overlapping stays by date, even when they belong to another city. `StayDetails.tsx`, `visits/Overnight.tsx`, `visits/model.ts`. | Add concise dates/status/area to detail and overnight context; distinguish “same dates” from “same destination”. S, no privacy decision, after current priorities. Preserve the read-only detail/edit distinction. |
| C9 / visitor correctness | No matched service schedule comparison completed; do not infer parity. | Local owner and visitor route times differ; route intro also incorrectly promises times stay private. Exact evidence below, `schemas.py`, `projection.py`, `ProjectionView.tsx`, `messages/en.json`. | Correctness follow-up S: verify PostgreSQL and normalize projection instants; align copy with the existing allowlist. Track in #94; no audience-widening decision. Application changes deliberately outside this documentation-only task. |

## B. Gap by design

| Existing row | Polarsteps behaviour | Travel today and boundary | Recommendation and decision |
|---|---|---|---|
| C1 / C3 / C5 | Private fixture's Share offers changing privacy; incognito cannot read the itinerary. What its hotels/spots/notes would expose after widening remains unverified (H/PW). | Two local visitor scopes show area/month for stays, museum summary/day, route fields at their fixed allowlist. No property, booking, class, private notes or precise hotel locations. `domain-model.md`, `projection.py`. | Keep private operational detail. ID1 can choose presentation only; hotel names, booking details or extra precise times require a separate publication/privacy decision. Do not publish the Polarsteps fixture to answer this. |
| A2 / B6 / B8 | Stay entry offers Booking.com, Airbnb, Hostelworld and Forward confirmation email; flight-service search and suggested attraction cards exist (PW/PN). | Manual entry and authenticated MCP over owner records; no vendor booking/search/mail pipeline. | Retain D1's MCP recipe recommendation; do not infer mail processing from a button. New provider integration or inbound mail needs its existing decision; actual VPS intake belongs in `tjorim/apps` only if selected. No new VPS work established. |
| B1 / B3 | Connector computes mode-dependent distance/duration, map route and reverse-direction default after reorder (PW). | Approximate owner-drawn route or line between approved endpoints; no recorded GPS history. | Preserve declared approximation. Routing provider/service details require their own cost/privacy/design review; no automatic GPS or background tracking follows from this comparison. |

## C. Travel is ahead — supported scope, not exclusive product claims

| Existing row | Polarsteps behaviour | Travel today and references | Recommendation |
|---|---|---|---|
| C1 / C3 | Trip-level Only me verified; equivalent per-record recipient selection unverified (PW/H). | Independently scoped public and named-link projections; private city visits and hotel locations absent while selected safe records remain. `routers/publication.py`, `projection.py`; H checks. | Preserve server filtering when recomposing the visitor view. Keep public/unlisted acceptance separate. This evidence is stronger than a screenshot alone, but not an exhaustive security audit. |
| C5 / C9 | Destination/stay/spot hierarchy verified; reusable locations shared across records and independent train booking records not established. | Area and location identity, independent dated visits/stays/routes, separate authored updates, private documents/tasks/packing, PWA and MCP mutation paths. `domain-model.md`, `mcp_server.py`. | Retain relationships and privacy boundaries; improve read views. Do not cite missing observations as proof Polarsteps cannot manage documents or scheduled transport anywhere. |
| C6 | Native planned destination/hotel/spot display verified online; offline result not tested here. | Existing read-only itinerary/offline copies and route-in-words fallback; phone shows named area/route controls even below the map (TN/C). | Preserve fallback and explicit saved-copy lifecycle. This follow-up establishes neither offline planning parity nor TalkBack superiority. M3/A4 remain open. |

## What the owner and visitor actually see

**Owner laptop:** Polarsteps at 1440 × 900 has a 56 px global header, a 100 px
side rail, a 430 px planning list and an 842 px map in the measured sample.
Both destinations, nights and connector fit in the list. Hotel/museum names
require opening the destination. Travel exposes different information through
Agenda and record groups; its overview map includes private hotel/museum points
and its booking badges report confirmation/coverage. Collapsed groups save
space but make cross-record comparisons harder (PW/TW, 2026-11-01).

**Owner phone:** Polarsteps' map and draggable sheet expose the plan and then
hotel/spot cards within a destination. The completed PN screen displayed the
booked hotel's 1–4 June dates and museum 2 June, 15:00 together. Travel's large
preferences/context stack reaches Agenda near the bottom of the first screen;
after scrolling, timed agenda entries are legible. This confirms M0's existing
header finding, not a new row. M1/M2 remain the reviewer-confirmed Sharing and
Capture defects from the mobile supplement; this pass does not duplicate them.

**Visitor laptop versus phone:** the text-only fixture has no cover. At
1280 × 800, Travel's Visits and Areas headings were around y=1,410, Stays and
Routes y=1,799, in two columns; at 390 × 844 the respective section containers
started around y=2,246 / 2,539 / 2,918 / 3,295, with 343 px width. The different
heading/container reference points are intentional; these are not directly
comparable to the rich fixture's narrower nested update article measurements.
Phone swipes confirmed all lower blocks exist and are readable (TW/TN,
2026-11-01). The first phone screen shows preferences, back link, title/dates,
summary and the start of the map, rather than itinerary details. Laptop gains
simultaneous map/story and paired lower blocks; phone has a long sequence of
separate concepts. Improve M4's information order on both.

**Visitor semantics:** a stay is currently shown as Taipei or Hualien and
“June 2035”, not as a hotel card with a booking status. That is selected date
precision plus the stay allowlist. A visitor cannot infer exact nights or
booked coverage from it. The museum has visitor text and a day but no 15:00;
route cards do show selected schedule/carrier/service/status. Story dates do
not turn private city visits into shared records. Public and unlisted GETs
contained the same approved collections; the renderer is common, while their
shell/notices/capability protections remain separate (H/C).

**Polarsteps visitor limit:** the private-trip denial establishes that this
fixture is protected. It does not establish which planning details appear on
Everyone/Followers trips or shared secret links. The generic public-trip story
and photo evidence remains in the visitor supplement. Do not label owner
planned-destination screens as anonymous visitor screens.

## Local route time and copy findings

On 2026-11-01 the owner API returned the synthetic train's departure as
`2035-06-04T02:00:00Z`, arrival `04:00:00Z`, with Asia/Taipei for both ends.
Owner Plan displayed **10:00–12:00**. Both local visitor projections returned
`2035-06-04T02:00:00` / `04:00:00`, with the same zone fields but **no UTC
offset**. The Europe/Brussels browser and physical phone displayed
**08:00–10:00**. The flight showed the same discrepancy (TW/TN/H).

`RouteResponse.mark_utc` in `backend/app/schemas.py` explicitly repairs naive
SQLite UTC values for owner responses; `backend/app/projection.py` directly
calls `isoformat()` on them. `ProjectionView.tsx` parses the resulting naive
string with `dayjs(value).tz(timeZone)`. This supports a local serialization
explanation. PostgreSQL normally retains timezone-aware instants, but it was
**not tested** here; do not report a confirmed production defect or apply a
frontend offset workaround. Follow-up: compare both database backends, preserve
an explicit offset in the projection, and verify a viewer in another zone sees
the entered local service time. Add visible zone context where useful.

The owner route introduction (`owner_how_you_travel_from_one_area_to_another_flight_train_bus_bike_stations_t`
in `frontend/messages/en.json`) says “Stations, times and bookings are optional
and stay private.” This contradicts the documented route allowlist and observed
shared times; another route editor explanation already distinguishes selected
sharing. Align the introduction in both languages with the actual contract.
**No unauthorized private-field disclosure was established:** schedule sharing
is allowed today, unlike booking/class/notes. Changing that policy would need
an explicit privacy decision rather than a copy-only fix.

## Proposed sequence and owner choices

At most five items, retaining the existing visitor-first order:

1. M4/A6b/A6c/A11: compact first screen, usable story/photos and approved
   itinerary context on both public and unlisted, laptop and phone.
2. Verify/fix the route instant/copy discrepancies above within the existing
   privacy contract; keep them tracked in #94 as correctness work.
3. Second-priority domain/data/storage review: include this mapping, PWA/MCP
   parity and the distinction between canonical records and derived read views.
4. C9/A1/M0: destination-focused owner reading, concise stay/overnight context
   and planned/booked/uncovered clarity, preserving Agenda and compact header.
5. A1b/ID3: only after deciding edit semantics, propose reviewed date shifts
   with booking conflicts; retain independent edits until then.

No implementation or infrastructure is selected by this analysis. Multiple
choice, recommended option first; record answers in #94:

- **ID1 Visitor itinerary display:** (a) group existing approved context by
  area/day, retaining all current omissions and date precision (recommended);
  (b) compact separate blocks with cross-links; (c) leave the current order.
  None authorizes hotel names, booking data or wider location/time disclosure.
- **ID2 Owner planning read view:** (a) destination/visit detail derived from
  existing records alongside Agenda (recommended); (b) improve only global
  record lists; (c) replace the records with one destination model (would need
  a separate domain decision and migration proposal).
- **ID3 Nights/reorder semantics:** (a) keep independent edits and clarify
  conflicts/scope first (recommended); (b) design an explicit proposed date
  cascade with per-record review; (c) automatically cascade unconfirmed records
  (not recommended without resolving booking/destination conflict semantics).

Unverified follow-ups remain: positive Polarsteps visitor itinerary exposure,
completed flight-service record, native transport editor and forwarding,
booking-email intake, sync timing, conflicts after multiple concurrent edits,
offline planning and full keyboard/TalkBack/locale/theme acceptance. The
original visitor supplement's print/video/performance/matrix limits still apply.
