# Polarsteps visitor fit-gap analysis (#94)

Standalone visitor supplement to the [desktop pass](polarsteps-fit-gap.md)
and [Android pass](polarsteps-mobile-fit-gap.md), written **2026-10-31**.
Public and unlisted viewing remain the owner's first priority; domain/data/storage
review remains second. This is evidence and proposed decisions, not application
changes or approval to widen any audience. Stable A/B/C/M identifiers refer to
those documents. S = one PR; M = several PRs; L = a larger design effort.

## Method, evidence and limits

Every observation below is dated **2026-10-31** and carries one of these tags.

| Tag | Method and scope |
|---|---|
| T | Live standalone Travel routes in the shared browser, desktop user agent. Reused the existing API on localhost:8000 and Vite on :5173; the proxy supplies development authentication. No existing process stopped. Current branch dependencies installed with `pnpm install --frozen-lockfile`, backend checked with `uv sync --all-groups --frozen`; Node 24.14.0 matches `.node-version`. This is a Vite development session, not deployed Caddy or a production performance test. |
| F | New local-only synthetic trip: three rounded Taiwan area points, two train routes, a visit and a private planned stay; six updates dated across March, long Dutch titles and Markdown paragraphs/lists/quotes; 0, 1, 3, 8, 1 and 0 approved abstract JPEGs, including portrait and panoramic originals; one approved cover. Reviewed the projection before local publication/activation against [publication-safety-check.md](../publication-safety-check.md): invented content, no addresses, people, bookings or live positions; private operational records absent. A separate empty surface tested publication then unpublication. Generated a two-second abstract MP4 and requested its derivative; it remained `processing`, so playable visitor video is **unverified**, not unsupported. |
| H | Local HTTP/API checks, including `curl -I` and HTML-shell GETs, synthetic link revoke/rotate and unknown capability; expiry simulated by backdating only the newly created synthetic link in the reused local SQLite database. No non-local writes. |
| P | Logged-out/incognito Polarsteps public web: long-running trip linked from [Travel Planner](https://www.polarsteps.com/travel-planner), then a shorter public trip reached through the public profile linked from [Travel Tracker](https://www.polarsteps.com/travel-tracker). Samples: 549 steps over 1,866 days, and 13 steps over 13 days. Only public material inspected; people, authored text, trip URLs and photographs omitted here. Cookie banner rejected; no likes, follows, comments, messages or sign-up. |
| N | Owner authorized this session's Android access. Physical Fairphone 6 / Android 16, agent-device 0.21.31 through device tools: opened the same long public trip in the signed-in native app, dismissed its Follow prompt, opened a step and swiped to another photo. No new trip, settings change or social mutation. Native app version unverified. This is not logged-out native evidence. |
| C | Current source, especially `visitor-routes.tsx`, `ProjectionView.tsx`, `TripHeader.tsx`, `TripMap.tsx`, `map-style.ts`, `saved-shared-trips.ts` under `frontend/src/`; shell entry points; `backend/app/routers/publication.py`; linked policies. Source evidence is not a completed interaction test. |
| R | Reviewer-confirmed owner findings supplied with this task: 390 px, Dutch Sharing group titles about 10–12 px wide, with Reisupdates wrapping over 12 lines; Capture date scrollWidth 111 > clientWidth 95; Save around y=1,966 in an 844 px viewport. These are existing **M1/M2**, not new visitor rows or a fresh reproduction. |

Evidence and scripts remain outside Git under `/tmp/visitor-fit-gap/`.
No screenshots, HARs, raw capabilities, real trip content or personal details are
included in this document or the PR. See [source privacy](../source-privacy.md).

**Coverage is sampled, not a full cross-product pass.** Travel's public and
unlisted routes were opened separately; dimensions below come from DOM rectangles
and actual `innerWidth/innerHeight`, not screenshot coordinates. Dutch/dark
provided the dimensional baseline; English and light were separately exercised.
Resize automation sometimes reported a requested setting while the page stayed
at its previous size: e.g. a 1440 × 900 setting still yielded 390 × 844 on
Polarsteps. Such repetitions were discarded. Travel measurements were obtained
at all sizes below, predominantly on unlisted with public spot checks; this is
**not** every viewport × audience × locale × theme permutation. Polarsteps had
an initial 1280 × 800 desktop session and confirmed 390 × 844 mobile-web samples;
tablet, other laptop sizes and zoom parity were attempted but not established.
CSS viewport emulation is not a physical-phone browser test. Travel was not
retested on physical Android in this pass; N covers Polarsteps native only.

150% and 200% equivalents below reduce a 1440 × 900 CSS viewport to 960 × 600
and 720 × 450; they test responsive reflow, not actual browser zoom or OS text
scaling. Reduced motion on/off is **source-reviewed only** here: #100's guards
remain, but no new matched browser-motion pair was measured. TalkBack, full
keyboard completion of every task, iOS, real network throttling on Polarsteps,
secure installed-PWA behaviour and a rendered print/PDF remain unverified.

## Standalone route findings

### First screen, width and photos (T/F)

Absolute document positions in CSS px, rounded. Fixture has a portrait cover
and a deliberately text-only first update; cover and first story photo are
therefore different milestones. One-to-four-pixel differences occurred across
loads. Article width includes text container width, not necessarily paragraph
line length (Markdown also has a reading-width cap).

| Actual viewport | Cover y / height | Trip title y | First update y / width | First story photo y / size |
|---|---|---|---|---|
| 1280 × 720 | 179 / 504 | 760 | 1250 / 581 | 2539 / 581 × 436 |
| 1440 × 900 | 179 / 630 | 886 | 1383 / 674 | 2683 / 674 × 505 |
| 1920 × 1080 | 179 / 756 | 1012 | 1461 / 1087 | 2761 / 680 × 510 |
| 960 × 600 (150% equivalent) | 179 / 420 | 676 | 2118 / 799 | 3401 / 680 × 510 |
| 720 × 450 (200% equivalent) | 179 / 315 | 571 | 1914 / 591 | 3195 / 591 × 443 |
| 820 × 1180 | 179 / 826 | 1082 | 2442 / 691 | 3726 / 680 × 510 |
| 390 × 844 | 269 / 591 | 936 | 2387 / 269 | about 3970 / 269 × 202 |
| 360 × 800 | 269 / 560 | 905 | 2412 / 239 | about 4125 / 239 × 179 |

The first screen does contain a photograph, but little trip identification:
preferences and the public-index back link precede the cover; the trip title
falls below the fold on 1280 × 720 and both phones. At 1440 × 900 only its start
is at the bottom. The portrait cover reaches the 70dvh height cap; it is not
proof all covers behave alike. Wide originals in strips use the same cropped
card framing; the lightbox uses `object-contain` (C). Improve the presentation
of each aspect ratio without publishing a different image.

Below 1100 px, the full map and its explanatory text precede updates. The
standalone 390 px article is 269 px wide; at 360 it is 239 px, even without a
preview dialog. This **qualifies M4**: dialog padding made the earlier preview
worse, but does not explain away the actual visitor-shell problem. Wide story
paragraphs are capped, but wide cards and the horizontal photo strip are not
uniformly the same reading measure. No document-wide positive horizontal
overflow was measured at these sizes; intentional photo-strip overflow is
separate.

**A6b/A6c are present, not missing.** Photos precede their own update text,
“5 days later” connectors render, and a map exists beside the story on wide
screens. Contrary to a blanket “sticky index” description, this map-beside-story
composition uses a **closed update disclosure even on desktop** (C/T). Opening
it exposes stable anchors. The full sticky index is used by the other story
composition. Do not add another independent navigation system before choosing
which composition to improve.

The map column is sticky with its own overflow scroller at ≥1100 px; at
1280 × 720 its container is capped to 672 px, while the follow checkbox was at
document y≈1907 (T). It can take scrolling *inside the map column* to reach
that checkbox after reading into the story. Below 1100 px it is hidden, and the
map is static (C/T). Preserve #98's user control, but make it discoverable.
This pass did not instrument camera synchronization or marker selection under
both motion preferences; source implementation is not proof of those effects.

Photo-strip next arrows (#97) are 44 × 44 px when available; previous starts
hidden. The 3/8-photo fixtures establish that this is not merely a one-photo gallery.
A measured English/light 360 px recheck found Next photo left `scrollLeft=0`
after click and keyboard Enter, including a two-second wait; directly calling
non-animated `scrollBy` moved it to ≈209 px. This contradicts a simple “arrows
work” conclusion: retest #97 smooth scrolling in a production browser before
assigning the cause to application code or automation. The lightbox
opens one image, focuses Close, and Escape returns focus to its trigger (T).
Its controls are Close and language selection: **A11 still has no next/previous
buttons**. Touch lightbox traversal in Travel remains unverified; source has no
swipe navigation. Native Polarsteps changed photos after one horizontal swipe
(N). Do not claim Travel swipe is broken from desktop emulation.

### Access states, headers and returning later (T/H/C)

`/` and `/trips/` rendered the empty public index before publication and a card
afterwards. An injected index-fetch outage showed “Trips could not be loaded” with Try
again; restoring fetch and activating Try again recovered the cards (T).
A published empty surface says “No shared content yet” with an
explanation. After unpublish, that same slug says “Trip unavailable / This trip
is unavailable.” The unavailable heading above it is generically “Shared trip”
even on the public route. Unknown, revoked, expired and rotated-old unlisted
URLs gave the same unavailable text and `/trips` back link, without a login or
reason. Old-token API requests returned 404; no stale story remained after
reload. No claim here that an already-open tab erases content on revocation.

| Response checked locally | Result (H) |
|---|---|
| Public shell, `/`, `/trips/` | HEAD 200, Vite `Cache-Control: no-cache`; no HTTP robots/referrer header. HTML includes no-referrer and noindex/noarchive meta. |
| Public projection/index API | GET uses `Cache-Control: no-store` (`publication.py`, C/H). API GET is the authorization check; HEAD is not a substitute. |
| Valid and unknown unlisted shell | HEAD 200, `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, noarchive`. |
| Revoked, rotated-old, expired unlisted API | GET 404 with those same three protections. |

The public and unlisted story renderer and preferences are shared. The
unlisted page itself gave no conspicuous capability/saved-browser notice near
the header in the sample; the index did explain that anyone using this browser
profile could reopen saved trips. Opening a valid link automatically saved its
capability and title in `travel-saved-shared-trips@1`; returning to `/` showed
the local saved-trip section (T). `visitor-routes.tsx` revalidates shortcuts,
removes denied entries and offers Forget/Forget all; Remove from this device was activated and the saved list became empty (T).
Forget all and storage-disabled recovery were source-reviewed only.
Never call this visitor offline support: successful revalidation is required
for a readable shortcut.

**Policy contradiction:** decision [36](36-privacy-sharing-offline-policy.md)
explicitly permits this browser-local list, while decision
[103](103-live-browser-route-contract.md) prohibits storing tokens and projection
bodies in localStorage. Current code follows 36. Decide and reconcile the
contract; do not silently “fix” it by removing a requested convenience. This is
not evidence that one audience can fetch another audience's private data.

**External resources qualification:** the map requested OpenFreeMap (T), and
`map-style.ts` fetches styles with `referrerPolicy: no-referrer` and omitted
credentials (C). Thus the first pass's absolute “share routes load no third-party
resource” statement is **incorrect for this implementation**. The map discloses
the viewed region and a provider notice; no capability-bearing external request
was established. Decision 103's literal no-third-party requirement needs alignment
with this map contract. This audit does not certify every tile/worker request's
headers or deployed proxy logs. No unapproved private-field disclosure was found
in the sampled projection; this was not a security scan.

### Failure, accessibility, loading and print (T/C)

- **Map failure:** replaced the page's style fetch with a rejection for
  `tiles.openfreemap.org/styles/*`, then changed theme to rebuild the map.
  “Interactive map unavailable” and its route-in-words explanation appeared;
  point and route buttons remained. This was a deliberate style-request failure,
  not the earlier environment's unexplained failed map. Normal map tiles also
  loaded during the pass. Pointer camera behaviour under failure was not tested.
- **Keyboard:** a Tab sample went through the selected language, selected theme,
  public back link, map, zoom controls and attribution links. Common controls
  had a computed ≈2.67 px focus outline in this environment; the map had ≈0.67 px.
  Lightbox Escape/focus return worked. The map's DOM position before the story
  adds keyboard travel. Full keyboard-only traversal of all galleries, index
  anchors and follow control remains an acceptance item, not a blanket pass.
- **Axe 4.13.0**, injected locally into the real public page at phone width,
  Dutch/dark with update disclosure open: `heading-order` (six first Markdown
  headings: update h3 → authored `##` rendered h5), `landmark-unique` (one
  repeated gallery-region target) and `nested-interactive` (one `.size-full` map
  target, serious). Colour contrast had an incomplete result. These are concrete
  candidates for repair/retest, not a screen-reader verdict or a clean axe claim.
- **Load:** a temporary local reverse proxy on :5177 forwarded to :5173, adding
  150 ms before each response and pacing each response at 200,000 bytes/s;
  concurrency remained unlimited. No CPU throttle or aggregate bandwidth cap.
  A cold-origin Vite public page at 360 × 800 produced 106 Resource Timing
  entries, 18,397,317 reported transferred bytes, first-contentful-paint
  32,164 ms, and cover-resource response end 32,906 ms. The latter is **load**,
  not image paint; below-fold lazy story photos were not timed. The image was
  present after load. Dev modules and uncompressed translations dominate this
  sample; it must not be used to rank production against Polarsteps.
- **Layout shift/scroll:** buffered Layout Instability entries on that load
  summed to 0.0262 excluding recent-input shifts (rough total, not a validated
  Core Web Vitals session-window CLS). A separate 60-frame scripted scroll on
  unthrottled Vite had mean frame gap 18.1 ms, maximum 66.6 ms and one buffered
  long task. This establishes occasional delay, not its cause, a reliable frame
  rate or physical touch jank. Repeat on a built release before optimizing.
- **Print:** `window.print()` was invoked; preview tools exposed no print dialog,
  download or PDF artifact. No rendered print result was verified. Source has
  no dedicated visitor print composition. Test pagination, clipped strips,
  sticky map, dark backgrounds, navigation and capability-bearing URLs in actual
  print output before promising save-as-PDF. A browser print stylesheet is a
  smaller task than A7's generated book; D4 is not automatically required for it.

## Link previews (H/P/C)

Travel's separate `landing.html`, `public.html` and `share.html` are data-free.
`curl` sees generic Dutch titles (“Travel · Op reis”, “Reis · Travel”, “Gedeelde
reis · Travel”), the same generic Dutch description, `lang=nl`, theme colour
`#12342c`, `/admin/icon.svg`, no OG tags, no Twitter tags and no manifest link.
The rendered browser title changes with interface locale but remains generic
rather than becoming the trip title. The visitor shell does not register the
owner PWA service worker. Do not add an owner manifest to visitor pages merely
for metadata completeness.

On the shorter Polarsteps page, a browser fetch of the original HTML returned
a generic product title/description, OG site/title/type/url and a branded OG
image, theme colour `#de2b52`, Apple/PNG icons, no Twitter tags or manifest,
and no initial document language. The hydrated page later acquired a trip/person
browser title and `lang=en` (P). The long page initially also showed generic OG
metadata. This **does not establish** what a social crawler gets with another
user agent: no WhatsApp, Signal, Facebook, X or chat preview was actually sent.
Neither a hydrated title nor OG tags prove a particular app's preview card.

Generic brand metadata/image is safe for either Travel shell if it contains no
trip fields or credentials. Public-specific title/description/approved image
would need a delivery/indexing decision: current HTML intentionally contains no
publication state; a future server-rendered response must check live publication,
cache invalidation and cover audience on every request. **Do not implement here.**
For unlisted links retain generic metadata: putting the trip title, summary,
photo or token in OG, Twitter, canonical URLs or an image URL can disclose it
to a third-party crawler and its cache. Even generic previews cannot prevent
the chat provider from receiving the capability when a recipient pastes it.
Noindex/no-referrer are not confidentiality guarantees. Trip-specific unlisted
previews require a fresh privacy decision; forwarding the link remains a bearer
capability handoff, never an invitation tied to a recipient.

## Polarsteps visitor evidence (P/N)

The initial long-trip desktop sample had a 56 px site header with Log in/Get the
app, story and map controls, Share and Gift a Travel Book. It eventually built
**13,147 image elements**. Resource Timing's default buffer held only 250 entries
and reported about 6.8 MB; cross-origin timing and buffer loss make that a lower
bound, not total page weight. A QR/app call to action appeared in the page.
The shorter trip built 94 image elements. These are DOM counts, not downloaded
files or a fair comparison with six synthetic Travel updates.

At confirmed 390 × 844, the site header remained 56 px. First story photos
started around y=417 on the long page (portrait card about 244 × 325) and y=389
on the short page (landscape card about 433 × 325 extending into the horizontal
strip). Both reach meaningful story media in the first screen. Full matched
laptop/tablet measurements were not obtained after the resize inconsistency;
retain the desktop pass's map-layout observations as historical evidence,
not fresh measurements at all requested sizes.

Share opened a dialog offering **Email** and **Share**; no send action was
activated. Destinations behind the latter were not verified. Like/comment
counts and liker names were visible anonymously; comment-thread access and the
login gate for contributing were not exercised. Story text was authored in
multiple languages while interface controls were English; no translation or
locale selector was exercised on mobile web. Private/followers-only/secret-link
visitor pages were **not opened**, so retain earlier H2 policy evidence without
claiming these states look like Travel's generic unavailable page.

On Android (N), opening that public trip first showed a dismissible sheet urging
Follow over a satellite map. Dismissing it exposed photo markers and a step
card. Opening a step presented a large photo with segmented photo progress,
title/date/country/weather, translation control and floating like/comment/share
bar. One horizontal swipe changed the displayed photo while keeping the step
context. Previous/next **step** traversal, native share-sheet destinations and
TalkBack were not tested. No follow/like/comment was performed. This is useful
native presentation evidence, not proof of logged-out native access or a reason
to copy native social controls into Travel.

## A. Gap we want

| ID / gap | Polarsteps behaviour | Travel today / references | Recommendation, size and decision |
|---|---|---|---|
| M4 + A6b: first useful story | P: story photos above phone fold under 56 px header; N: map and photo sheet. | T: preferences/back link, portrait cover then title; map before story on narrow screens. See dimensional table, `TripHeader.tsx`, `visitor-routes.tsx`, #94. | Compact preferences, identify the trip before/alongside the cover; make narrow map collapsible or subordinate to first story. S–M, choose VD1; no new privacy scope. A6b stays delivered. |
| A11: traverse an update's photos | N: swipe changes photo; P: multi-photo strip. | T/C: #97 arrows exist but the measured smooth-scroll recheck did not advance; dialog has no traversal controls. | Named previous/next, keyboard and touch sequence with focus return, captions and position count. S–M, no privacy decision; reuse A11, do not create a separate swipe backlog. |
| M4 + A6c: map/story control | P desktop map/story presentation; N photo markers; no claim of a follow checkbox there. | T/C: #98 sticky independently scrolling map, follow checkbox low inside it; mobile static stack, wide map composition also folds update index. | Put follow control at map top; keep marker/story linkage, test reduced motion and failure. S–M, VD1 for composition only. Preserve A6c's approved-image/area rule. |
| M4: visitor accessibility | Polarsteps keyboard/axe parity unverified; N progress and translation affordances. | T: three axe rule findings, thin map focus, keyboard path through map before story. `ProjectionView.tsx`, `TripMap.tsx`, #94/#5. | Repair heading mapping, unique gallery names and map interactive semantics; retest axe, keyboard, both locales/themes and text scaling. S–M; no privacy decision. |
| V1: useful safe previews and onward sharing | P: generic branded OG HTML; Share dialog offers Email/Share. | H/C: no OG/Twitter image; generic locale title; no visitor share action in `visitor-routes.tsx`. | Generic brand OG first; optional copy/share URL with clear capability warning and fallback. S; VD2 before public-specific delivery; any unlisted-specific metadata needs a privacy decision. |
| M4 / A7 distinction: browser printing | Polarsteps print result unverified; branded books are A7. | C/T: no verified printable visitor result; strips/sticky map need review. | Validate ordinary browser printing and add scoped print styling if needed. S–M, no new data; keep generated book under A7/D4. |

## B. Gap by design

| ID / boundary | Polarsteps behaviour | Travel today / references | Recommendation, size and decision |
|---|---|---|---|
| B4/B7: social layer | P: anonymous counts/liker names, app pressure; N: Follow prompt. | No identities, follows, likes or comments; decision 36, PLAN. | Keep absent. Reversal is XL with D6, identity/consent/moderation; do not bundle into visitor polish. |
| B1/B2: live map | P/N: ongoing trip, route and latest-step context; active privacy enforcement unverified. | Generalized selected areas/drawn lines, no GPS capture; domain model and decision 36. | Keep boundary. Reversal needs D5 plus capture/delay/retention policy, XL. Presentation does not authorize tracking. |
| C2 / V1: capability previews and persistence | Secret-link visitor appearance unverified in P/N. | Generic unlisted shell; automatic browser-local shortcuts follow 36 but conflict with 103. Map third-party wording also conflicts with literal 103 text. | Choose VD3 and reconcile docs. S for contract clarification; implementation size depends on choice. Keep no-store/noindex/no-referrer and no unlisted offline pinning. |
| B9: discoverability | P: public profile lists public trips. | Only deliberately published surfaces appear in `/` and `/trips/`; share shortcuts are device-local (`visitor-routes.tsx`). | Preserve. Public SSR/indexing needs VD2; never list unlisted links server-side. No VPS work selected. |

## C. Travel is ahead

| ID / advantage | Polarsteps behaviour | Travel today / references | Recommendation, size and decision |
|---|---|---|---|
| C1/C3: selected content | P/N show public trip content; equivalent per-record preview not verified. | F/C: server projection separates private stay/location and visitor story; approved derivatives only. `publication.py`, domain model, safety check. | Preserve while simplifying presentation. No new decision/size beyond M4; no claim of exhaustive security validation. |
| C2: lifecycle | Secret/private/followers visitor states not exercised here. | H/T: revoked, expired, rotated-old and unknown produce generic denial with protective headers. | Retain and regression-test after shell changes. S acceptance work, no new privacy decision. |
| C3: quiet reading | P cookie banner, Get the app/QR/Gift Book; N dismissible Follow pressure. | T: no social upsell or consent banner; map provider notice and route fallback. | Keep restraint. Compact existing preferences; do not replace them with acquisition prompts. No privacy decision. |
| C8: interface choice | P English controls; native translation control seen, not exercised. | T: Dutch/English and light/dark choices; authored Dutch remains Dutch in English UI. | Preserve selected-locale copy without translating authored content. S acceptance work, no claim Polarsteps lacks language support. |
| C3: map failure resilience | Equivalent Polarsteps failure not tested. | T: deliberately failed style leaves readable routes and point controls. `TripMap.tsx`, #98. | Preserve; improve control placement and keyboard semantics. S under M4, no new scope. |

## Visitor tasks and interaction counts

Counts are control activations **after the page loads**, excluding typing,
scrolling, cookie rejection, network time and OS app launch. “Open link” includes
one activation in the originating app. Counts distinguish demonstrated actions
from source-derived paths; they are not equivalent timed usability benchmarks.

| Task / start | Travel public | Travel unlisted | Polarsteps public | Implication |
|---|---|---|---|---|
| Open received link | 1; no login (T) | 1; auto-saves locally (T) | 1 on web; native adds a dismissible Follow sheet (P/N) | Keep anonymous opening friction low. |
| Find first photo from page top | 0 after load: cover at y179 desktop / y269 phone (T) | Same fixture/layout (T) | 0: first story strip around y389–417 phone (P) | Travel's first photo is not its first story; compare identity and story too. |
| See all 8 photos of one update, individually enlarged | 8 opens + 7 intervening closes = 15, plus final close if leaving (C/T: one dialog open/close verified) | Same renderer (C) | N: open step 1 + successive horizontal swipes; full eight-photo count not measured | A11 removes repeated close/reopen. Strip scrolling alone is a different task. |
| Jump to a later update from visible index trigger | 2: disclosure → anchor; same wide map composition (C/T disclosure verified) | Same (C/T) | P: scroll story or map navigation; exact count unverified | Keep the disclosure easy to find before a large map stack. |
| Find place on map from visible controls | 1 point-button activation; scrolling to controls excluded (C/T controls observed) | Same (C/T) | N: marker/step map context visible; exact path unverified | Count scroll cost separately; wide checkbox has nested-scroll cost. |
| Share link onward | No in-page action; browser URL/share UI count varies (C/T) | Same, with credential-forwarding implication | 1 opens Share dialog, then Email/Share; no send tested (P) | A small visitor action can help, with capability wording. |
| Come back later from index | Public card 1 (T) | Saved local card 1 after revalidation; first open saved it (T/C) | Reopen browser link; account follow path deliberately not used | Saved is browser-local, not an account subscription or offline copy. |

## Laptop versus phone

Laptops have room for the story beside a persistent map and larger landscape
photos; they also make the wide follow-control scroller and hidden index worth
fixing. At 1920 px the article card spans 1087 px while paragraphs remain capped:
use the space for photos and context, not longer text lines. A portrait cover
still postpones the title and first update. Laptop viewers deserve explicit
acceptance cases, not a stretched phone design.

Phones make received links immediate and portrait photos compelling. Travel's
preferences, cover, title and full map stack cost several screens before the
first update; 239–269 px article widths need less nested indentation. Polarsteps'
phone web gets story media into the first fold; native keeps map context behind
a photo-led sheet but adds social pressure. Tablet Travel currently inherits the
stacked map despite its available width; treat 820 px as its own composition.
At zoom equivalents the laptop likewise becomes a stacked layout, so the phone
fix benefits low-vision laptop use too. Physical browser chrome, touch inertia,
soft-keyboard and OS text scaling remain separate verification needs.

**Owner findings are already M1/M2 (R).** Keep the 10–12 px Sharing titles,
111 > 95 date clipping and y≈1966 Save evidence with those existing rows in the
mobile supplement. They follow visitor viewing and domain/storage review;
there is no new visitor defect ID for them.

## Roadmap (proposed, at most five items)

1. **M4/A6b/A6c:** title/cover/preferences density and narrow map placement;
   make follow control discoverable and retest #97's non-advancing arrow sample. Accept both standalone audiences on phone,
   tablet, laptops, zoom equivalents, both locales/themes; preserve projection
   safety. Choose VD1 before composition work.
2. **A11 plus M4 accessibility:** photo sequence with buttons/keys/touch, repair
   the concrete axe targets, validate focus/index/map failure and reduced motion.
   Complete the unverified matrix on a built release, including print and
   aggregate-throttled loading; do not optimize from the Vite numbers alone.
3. **V1 and contract alignment:** generic safe preview metadata and optional
   onward-share affordance; decide VD2/VD3, reconcile 36/103's browser storage
   and map wording before extending delivery. No unlisted content in previews.
4. **Domain/data/storage review**, including PWA and MCP editing as already
   ordered in PLAN/#94. Then owner M0/M1/M2 and the retained Capture FAB.
5. **Optional additions later:** A5/A6 only after D3; M3/offline acceptance
   before D2, A7 after D4. No new VPS implementation selected: existing
   [apps#219](https://github.com/tjorim/apps/issues/219) already tracks visitor
   route/header deployment, not verified by local Vite. Do not open a duplicate.

## Owner decisions

Recommended choice first; these do not replace D1–D6 or MD1–MD3.

**VD1 — Visitor first screen.** (a) Compact preferences, title before/alongside a
bounded cover, story first with an optional narrow-screen map (recommended).
(b) Map first with a compact story-jump action. (c) Keep the present stack.

**VD2 — Preview scope.** (a) Generic brand metadata for both audiences now;
consider live-checked public-specific metadata separately (recommended).
(b) Design public-specific server delivery now, keeping unlisted generic.
(c) Leave all metadata unchanged. None authorizes unlisted-specific previews.

**VD3 — Browser-local unlisted shortcuts.** (a) Retain decision 36's convenience,
reconcile 103 and make the saved-browser/capability notice visible at first open
(recommended). (b) Require explicit opt-in before saving. (c) Remove automatic
persistence and follow 103 literally. All keep Forget controls and denied-link
cleanup; map/provider wording must also be reconciled with actual delivery.

**VD4 — Complete the remaining evidence.** (a) Built-release browser matrix,
actual text zoom/reduced motion, print/PDF and secure physical-phone browser
checks before closing M4 (recommended). (b) Accept these documented limits and
implement a first presentation slice, then repeat the matrix. (c) Pause visitor
changes. This document is a partial audit, not a claim that every requested
combination or Polarsteps privacy state was verified.
