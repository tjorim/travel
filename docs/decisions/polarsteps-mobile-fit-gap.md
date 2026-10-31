# Polarsteps mobile fit-gap analysis (#94)

Phone supplement to [the first pass](polarsteps-fit-gap.md), part of
[#94](https://github.com/tjorim/travel/issues/94), against the implementation
stacked in [#100](https://github.com/tjorim/travel/pull/100). Written 2026-10-31.
A1–C11 and D1–D6 below refer to that document. This is documentation, not a
product decision or an implementation plan approved by the owner.

## Method and sources

All observations below are dated **2026-10-31**. Tags identify the evidence;
“unverified” means this pass did not establish it, not that a feature is absent.

- **P1 — physical Android app:** signed-in Polarsteps on a Fairphone 6,
  Android 16, through T3 device tools and agent-device 0.21.31. The owner
  authorized installing that required version. App version was not established;
  do not transfer the first pass's iOS App Store version to this Android build.
  Read Settings and inspected creation, privacy and empty-trip controls. No real
  trip was opened. Account values, profile details and real trip names are
  deliberately excluded from this document.
- **P2 — private synthetic trip:** created `Synthetic Mobile Fit Gap`, explicitly
  **Only me**, tracker off, ultimately bounded to 1–2 October 2026. An initial
  open-ended current-trip attempt was refused for overlap; the error was visual
  but missing from the interactive accessibility snapshot. Inspected the empty
  story, step editor, trip settings, Location privacy, Plan/Track switch and Reel
  chooser. Deleted the trip and its draft through the confirmation afterwards.
  Nothing was published, shared, ordered or sent to another person.
- **P3 — offline experiment:** with the owner's permission, enabled airplane
  mode **and disabled Wi-Fi**, wrote synthetic text in the already-open step
  editor, chose **Save as a draft**, and reopened it while offline. It appeared
  as **Offline draft** and its text was readable. After airplane mode was turned
  off and Wi-Fi restored, it still said Offline draft in the next observations.
  No server-side sync or cross-device persistence was established. “Publish step”
  was deliberately not used, even inside the Only me trip.
- **T1 — physical phone browser:** Travel's Vite development server over LAN
  HTTP, same phone in Chrome, development API authentication bypass, new local
  SQLite schema and only synthetic records. Three areas, two routes, a planned
  stay, three illustrated updates with generated abstract JPEGs, one Capture
  update and a separate empty trip. No publication or active link. Used Capture,
  the section drawer, Plan, Sharing and **View as visitor**. English/light and
  Dutch/dark were inspected on the phone; this was sampling, not every screen
  in all four combinations. Android exposed browser chrome but not the web
  controls to agent-device, so web taps used the current screenshot coordinates.
- **T2 — narrow desktop browser:** 390 × 844 CSS px, desktop user agent, same
  synthetic backend. Used for DOM target measurements, the empty-trip card,
  keyboard Escape/focus return, the nights stepper and visitor preview. Selected
  both locales and themes. This is supplementary evidence, not a phone speed,
  touch or screen-reader benchmark.
- **C — current source:** file references in the tables. The first pass's H/W/N
  sources remain secondary evidence where referenced; they were not reread or
  relabelled as native-app observations in this pass.

Privacy follows [source-privacy.md](../source-privacy.md). No screenshots,
recordings, account data or trip assets are included in Git. Device-rendered
screens were inspected transiently; runtime diagnostics remain outside the
repository. The synthetic seed scripts were adapted outside the repository
rather than reusing their hardcoded trip ID.

**Coverage limits.** This is a partial native-app audit. Tracker enablement UI
and its battery explanation were inspected, but recording was never enabled:
accuracy modes, actual location samples, background operation, battery drain,
tracker sync cadence and OS permission guidance remain **unverified (P1/P2)**.
The ended test trip disabled live-location controls; their active-trip effects
were not tested. Offline text drafts were tested, but cold-start offline maps,
photo/video addition, editing a published step and later server sync remain
**unverified (P3)**. The photo/video entry point was seen, but no personal
library was opened and no media was selected. Future planned-step creation,
transport selection, booking-email forwarding and AI itinerary flows remain
**unverified in the phone app**; retain A2/B6/B8's web/help evidence only.

Travel Buddies was visible in creation/settings, but invitations and co-editing
were not exercised. Stats exposed Add countries; scratch-map editing and
computed statistics were not verified. Reel types were visible, but generation,
playback and export were not exercised. Travel Books' settings entry advertised
generation, editing and ordering; no book was generated or ordered. Account
exposed download guidance; no export was requested or downloaded. Notifications
opened Android's per-app notification settings, with a New steps category;
delivery was not tested. Genuine first-run onboarding, haptics, screen-reader
speech, iOS, large-trip performance and prolonged battery use remain unverified.

Travel's LAN HTTP origin is not a secure context: installation and a durable
service-worker/offline-copy lifecycle were **not verified on the phone**. The
production manifest and service worker were read (C); a Vite session is not a
production PWA acceptance test. Map styling failed in the desktop sample;
phone preview map appearance was not established reliably. Do not infer a
production map defect or compare map-loading speed from this run.

## A. Gap we want — mobile additions

Ranked for laptop preparation first (including checking that plan on a phone),
then active trips, then visitors. S = one PR, M = a few PRs, L = several issues
and a decision. These are proposed follow-ups tracked in #94; application fixes
are outside this documentation-only change. Existing A1–A11 retain their order.

| # | Feature | Polarsteps phone behaviour | Travel today | Recommendation |
|---|---|---|---|---|
| M0 | Compact phone header, retain Capture FAB | The native trip puts its title and floating actions over the map, with Plan/Track at the bottom (P2). | The phone workspace stacks locale/theme preferences, Account, breadcrumb, trip status/title/dates, Trip details, section trigger and Jump to before the section content (T1; `frontend/src/trips/WorkspaceHeader.tsx`, `frontend/src/pages/TripWorkspace.tsx`). | **Owner direction, 2026-10-31: the header is too big; retain the Capture FAB.** Reduce persistent header height, move secondary preferences/actions behind an accessible menu or disclosure, and keep the full trip title and current section identifiable. Check FAB overlap with content, bottom navigation and the soft keyboard. S–M; coordinate with existing layout issue #5 and track here in #94. Exact composition still needs review; no application change in this analysis. |
| M1 | Readable sharing review on a narrow phone | Trip privacy is a dedicated three-choice sheet: Only me, Followers, Everyone, with a sentence explaining the selected audience (P2). This is trip-level privacy, not evidence of equivalent per-record control. | In Dutch/dark on the phone, visibility-group headings such as Reisupdates and Gebieden wrapped one letter per line beside their counts (T1). Other scope groups lower down wrapped normally. See `frontend/src/trips/PublicationManager.tsx`, `frontend/src/trips/SectionAccordion.tsx` and Sharing compositions. The review remains functionally deeper than Polarsteps (C1/C3), but hard to scan. | **First mobile correction, S.** Give group titles adequate width or stack their summaries; verify 320–430 px, both locales/themes, while retaining audience checks. No privacy decision; child work under #94. Do not replace per-item scopes with a trip-wide switch. |
| M2 | Short capture path and legible date | Empty trip says Add your first step; the flow chooses location/date/time, then text/media. Save is in the editor header and offers Publish step or Save as a draft (P2/P3). | Capture opens in one tap and defaults to private. On this phone its safety explanation, Markdown tools, photo links and optional location push Save several scrolls down; the date field visibly clipped the year (T1). `frontend/src/trips/CaptureDialog.tsx`. | **Active-trip priority, S–M.** Keep title/notes and the save state close together, reveal optional details progressively, preserve draft/focus and fit the full date. Keep the private/public explanation discoverable. No new media or GPS work; no privacy decision. Track under #94. |
| M3 | Prove installed/offline behaviour on a secure phone origin | Already-installed native app; an offline draft can be written, saved and reopened (P3). No evidence here that it syncs automatically. | Local draft feedback was visible and an online Capture save succeeded (T1). Explicit offline copies exist in `frontend/src/offline/`; `frontend/public/service-worker.js` caches shell and fetched hashed assets, not arbitrary owner API responses (C). LAN HTTP prevented a fair installation/offline lifecycle test. | **Verification follow-up, S; authoring remains A4/L.** Test a locally served production build on a secure phone origin: install, reopen, pin/read/remove copies, offline draft/reconnect and sign-out cleanup. No new infrastructure requirement established. Keep D2 unanswered until this is distinguished from an outbox. |
| M4 | Phone visitor-preview density and photo traversal | Native trip uses a map above a draggable story sheet and a Plan/Track toggle (P2). Native multi-photo swiping was not tested. | Phone preview rendered the synthetic photo before its story, but dialog, preview wrapper and cards leave a narrow content column; the map precedes the story, rather than sitting beside it (T1, `RenderedPreview.tsx`, `ProjectionView.tsx`). A6b/A6c's wide-screen layout cannot be assumed to carry over to a phone. Only one photo per update was seeded. | **Visitor priority, S–M.** Reduce nested phone padding and recheck the actual visitor shell without publishing. Extend A11's lightbox navigation to touch as well as named buttons/keys; test multiple synthetic photos before proposing swipe behaviour. No privacy change. Track under #94; no claim that swipe is currently broken. |

No new recommendation for AI, booking ingestion, account export, trip numbers
or offline maps is justified by this phone sample. Keep A1–A8 and their
existing decisions rather than duplicating them as mobile features.

## B. Gap by design — what the phone changes

| Feature / first-pass row | Polarsteps phone behaviour | Travel today and boundary | Recommendation / what reversal requires |
|---|---|---|---|
| Tracker (B1/B3) | Current-trip creation showed Travel Tracker checked; tapping info explains automatic route tracking and calls it battery friendly. Switching it off shows a warning that the trip is not being logged. Ended-trip tracker is disabled (P1/P2). Accuracy modes and actual recording unverified. | No recorded-track model; approximate drawn routes, not GPS histories (`docs/domain-model.md`). [AGENTS.md](../../AGENTS.md) requires an explicit decision before GPS capture; [PLAN.md](../../PLAN.md) excludes recorded GPS, live or finished. | Keep the boundary. The website's numeric battery claim in B1 is **not** an app measurement: the observed app explanation gives no percentage. D5 and a new capture/retention/native-platform decision would be needed before implementing anything. |
| Live/start position (B2) | Location privacy visually contrasts hiding the route after the last step with showing the full route. Start-location UI describes hiding within a 5 km radius. Live toggle appeared on but disabled because the synthetic trip had ended; start was off (P2). | Decision [36](36-privacy-sharing-offline-policy.md) forbids live/near-real-time positions in projections. No live capture in Travel. | Keep B2. This confirms the existence of separate controls, **not** their active-trip defaults or enforcement. Reversal needs a new capture/audience/delay/expiry policy; a hiding radius alone is no substitute for it. |
| Followers and approval (B4) | Settings offers Anyone and Only followers I accept; trip privacy separately offers the three audience levels (P1/P2). No follow request was sent or accepted. | Decision 36 and PLAN: no viewer identities or sharing groups; links are forwardable capabilities. | Keep D6(a). Reversal needs recipient identities, authorization and revocation, not just a renamed privacy toggle. Do not treat an accepted follower as equivalent to a named link. |
| Travel Buddies (B5) | Add Travel Buddies appears during creation and in trip settings (P2); invite/co-edit effects unverified. | Owner-subject authorization; no co-editors (`backend/app/auth.py`, PLAN's owner-only boundary). | Keep B5/D6. A new multi-owner authorization, conflict and audit model precedes collaborative UI. No one was invited for this audit. |
| Native social notifications (A5/B4/B7) | Notifications in Settings hands off to Android per-app controls; New steps category observed (P1). Actual delivery unverified. | No follower identity model. Public feed proposal A5 is narrower than native push. | Do not inflate A5 into social push. Reversal needs D3/D6 plus subscription/consent and delivery lifecycle decisions. No VPS work selected by this audit. |
| AI, forwarding, commercial outputs (A2/A7/A8/B6/B8) | Phone flow not verified for AI/forwarding/transport. Reel chooser exposes Collage Reel and Route Reel; Travel Books entry advertises generate/edit/order (P1/P2). | MCP-assisted planning and owner records; no built-in AI planner, mail intake, book checkout or replay. See first-pass rows for source-backed scope. | Keep existing D1/D4 and B8. Do not copy a vendor/data transfer or open VPS delivery work merely because a phone menu exists. Actual inbound mail or self-hosted tiles, if selected later, belongs in `tjorim/apps`. |

## C. Travel is ahead — mobile evidence and qualifications

| Feature / first-pass row | Polarsteps phone behaviour | Travel today | Recommendation |
|---|---|---|---|
| Private capture (C1/C3) | Current-trip form initially showed Followers and tracker on in this account/session. Only me required opening privacy, selecting it and confirming. Save-step sheet also offers a draft (P1/P2/P3). Do not assume these defaults for every account. | Capture explicitly explains that notes, location and originals are private and visitor text is written later; saved synthetic Capture update remained private (`CaptureDialog.tsx`, T1). | Preserve the split and reduce presentation cost under M2. Privacy safety is an advantage even when it costs screen space. |
| Planning without tracking (C9) | Ended trip's tracker is disabled; Plan/Track is the primary trip switch (P2). Phone transport/planning depth unverified. | Planned stays have private booking/status context and a nights stepper. One phone tap changed three nights to four; API confirmed checkout moved by one day (T1). Buttons measured 44 × 44 CSS px in T2 (`trips/stays/StayList.tsx`). | A1b's nights work is already delivered in #100. It is offered only on private idea/planned stays; preserve that protection. This pass cannot claim Polarsteps lacks booking depth. |
| Preview without delivery (C3) | Only me trip could be used without sharing; equivalent per-record preview unverified (P2). | View as visitor rendered three synthetic updates and their approved derivatives without activating a public page or link (T1/T2, `RenderedPreview.tsx`). | Preserve the server projection and explicit activation. Improve M1/M4, not the access boundary. |
| Keyboard navigation and fallbacks (C3/C6) | Android snapshot exposed some groups but missed important visible labels and the overlap error (P1/P2). This is tooling evidence, not a TalkBack verdict. | Drawer links measured 44 px high; Escape closed it and returned focus to Trip sections (T2). Map has named point controls and route-in-words fallback (`TripMap.tsx`). | Preserve these affordances. Neither product has a screen-reader pass from this audit; do not repeat “Travel is more accessible” as an established native comparison. |
| Language and theme controls (C8) | Polarsteps was inspected in English; app language/theme selection unverified (P1/P2). | English/light Capture and Dutch/dark drawer, Sharing and Plan were readable apart from the documented layout defects (T1); both locale/theme selectors exercised in T2. | Keep parity for every mobile fix. This demonstrates Travel's controls, not exclusive language support over Polarsteps. |

## Visual comparison

Polarsteps commits the screen to a satellite map with round floating actions,
a white draggable sheet and a large bottom Plan/Track toggle (P2). Its empty
story has one Add action. Travel uses paper/green cards, persistent bottom app
navigation, a floating Capture button and a six-section drawer (T1). It feels
like a private workspace rather than a social profile. Retain that distinction.

**Owner feedback, 2026-10-31:** the phone header is too big, while the Capture
floating action button (FAB) is a good direction. Treat a compact header with
the FAB retained as the preferred direction (M0), not as a reason to remove
quick capture. The inspected header spends much of the first screen on
preferences and trip context before reaching useful section content. Move
secondary controls out of the persistent stack; preserve accessible access to
them, the full title and the current section. No exact layout has been approved.

The first pass's wide-screen “map beside story” equivalence does **not** apply
at phone width: the inspected Travel preview stacks the map before the story.
Photos do precede text now; a lone synthetic photo does not verify the strip's
multi-photo swipe, arrows or lightbox sequence. The preview's nested padding
also makes it a harsher sample than the standalone visitor shell. M4 needs both
surfaces checked. No publish/share action is necessary to inspect the projection.

The most consequential visual finding is Sharing's letter-by-letter group
headings in Dutch on the physical phone. It is not just a preference for a
quieter style: it makes a safety review difficult to scan. Capture's clipped
date and long optional form are next. Conversely the drawer and nights controls
are legible and comfortably tappable in the observed sample.

## Polish and motion

The first pass's historical statements that Travel has no layer transitions
and forces map animation are **superseded by #100**, not contradicted by a new
Polarsteps discovery. The current `frontend/src/RecordDialog.tsx`,
`frontend/src/trips/WorkspaceNavigation.tsx` and `frontend/src/TripMap.tsx` contain the
new transitions/reduced-motion handling. Do not reopen A9 as if none shipped.

Polarsteps sheets, the mode switch and the map-led layout provide coherent
spatial navigation (P2). Travel's drawer and Capture are useful layers, but
long forms obscure the primary action (T1). No timing, frame-rate or haptic
measurement was made; tool “settled after” durations include automation and
are not interaction latency. Loading was seen during lazy navigation in Travel;
this does not establish native-versus-PWA speed. Touch gestures beyond scrolling
were not systematically tested. A motor/vision accessibility review still needs
TalkBack, text scaling, reduced motion and the soft keyboard on a secure build.

The 44 px check is **not uniformly green**. In T2, bottom navigation, drawer
links and nights buttons met it; the Trips breadcrumb was about 34 × 44 px,
Full summary and Manage in Prepare about 43.3 px high, and attribution links
smaller. Treat those as audit candidates under M1/M4 rather than claiming every
control meets the target. Do not round 43.3 up to a pass.

## Ease of use

Counts are taps on named controls, excluding text keystrokes, scrolling and
app launch unless stated. Failed overlap and keyboard-dismiss retries are
reported separately. Rows are **not equivalent end-to-end benchmarks**.

| Task and starting point | Polarsteps phone | Travel phone / narrow desktop | Implication |
|---|---|---|---|
| Reach a new-trip form from home/profile | Add trip → current/future/past → Continue: **3 taps** (P1). | Home New trip: **1 activation** is available in the empty-home DOM (T2); full creation count not measured. | Phone adds a useful phase question but more up-front work. Do not copy it without a use case. |
| Make the unsaved Polarsteps trip Only me | Privacy → Only me → Change privacy level: **3 taps** (P2). | **0 privacy taps** at creation/capture: new content is private (C/T1). | Keep Travel's private default. |
| Add a text draft from an empty trip | Add → location search → result → Add step → body focus → Save → Save as a draft: **7 taps**, plus typing (P2/P3). | Capture → title focus → Save travel update: **3 taps**, plus typing and **3 downward scroll gestures** in the sampled phone form (T1). This saved online, not an offline server sync. | Tap counts conceal scroll cost and different semantics. M2 reduces travel friction without weakening privacy. |
| Switch trip section from overview | Plan/Track toggles in **1 tap**, but only those two modes (P2). | Trip sections → Plan/Sharing: **2 taps** (T1); same flow confirmed in T2. | Drawer is acceptable for richer preparation; do not count it as equal information architecture. |
| Add a night from the visible stay row | Native phone count unverified; first-pass V2 web stepper was one click. | **1 tap** on +, phone and T2. From overview: drawer → Plan → expand Stays → + is **4**, with scrolling. | A1b is useful already; A10 still saves an extra creation step. |
| First destination from empty overview | Native future-planner count unverified. | First-steps link opens Plan's Areas block in **1 activation** but no editor; New area is another (T2). | Confirms A10 remains open; no new duplicate item. |
| Reopen offline text | Saved Offline draft → tap its card: **1 tap**, text readable (P3). | Cold-start offline phone count unverified. | A4's help-centre evidence is not replaced by an untested Travel claim. |
| View visitor projection | Per-item equivalent unverified. | From overview: drawer → Sharing → View as visitor: **3 taps**, with extensive scrolling in the sampled Sharing page (T1). | M1/M4 should reduce scanning and padding, keeping deliberate publication separate. |
| Reach notification controls | Settings → Notifications: **2 taps** from profile, opens Android controls (P1). | No equivalent follower-push task. | Not a reason to add social identities. |

## Recommended roadmap

1. **M0/M1: compact the phone header, keep the Capture FAB, and repair narrow
   Sharing review (S–M).** Coordinate header work with #5; audit small targets
   and FAB overlap. Existing scopes stay intact. This supports laptop
   preparation followed by phone review.
2. **M2: compact Capture and fit its date (S–M).** Keep draft recovery, safe
   dismissal and private notes; make the save state/action easy to reach.
3. **M3: secure-origin phone acceptance pass (S).** Install/relaunch, actual
   offline copies and reconnect, keyboard/TalkBack, all four locale/theme
   combinations and multi-photo synthetic fixtures. Finish the unverified
   Polarsteps flows with owner-controlled evidence where needed.
4. **A10 plus existing A1/A2/A3.** First-steps direct creation remains a small
   navigation improvement; this partial phone audit gives no reason to displace
   the owner's laptop planning and portability priorities.
5. **M4 with A11 (S–M): phone visitor preview and photo navigation.** Compare
   standalone and preview layouts, not just desktop parity. A4 remains gated on D2.

## Open decisions

Recommended choice first. These refine the first pass; D1–D6 remain open in #94.
No answer here authorizes GPS, invitations, publication or external transfers.

**MD1. What should phone Capture prioritize?** (a) Title and private note with
optional details collapsed, keeping explicit Save (recommended). (b) Keep the
full form, add a persistent Save action. (c) Keep the current flow.

**MD2. What should the offline follow-up prove before choosing D2?** (a) Installed
secure-origin read-only copies and local drafts first (recommended). (b) Choose
an automatic outbox now, then design conflicts, retries, attachment retention
and account isolation. (c) No further offline work. The P3 result does not prove
published-step sync and is not evidence for choosing (b).

**MD3. How should this partial native comparison be completed?** (a) Owner-supplied
recordings using synthetic Only me trips for future planning, accuracy settings,
media and sync, with no real content visible (recommended). (b) Another assisted
Android session with synthetic media prepared outside Git and separately agreed
tracking/permission tests. (c) Accept the listed unknowns; do not infer parity
from web/help sources. iOS and long-running battery tests remain separate.
