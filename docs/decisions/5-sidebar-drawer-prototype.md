# Sidebar and section drawer prototype (#5)

## Decision and recommendation

Second discovery, 2026-10-31, based on current `origin/main`
`abb0929` (merged #87). The issue's **Decision (owner)** selects persistent
desktop sidebar and mobile section drawer; it supersedes the first discovery's
recommendation, not its measurements. This document measures that direction.
**No layout ships here; approval of the implementation slices is still needed.**

Recommend a trip-local sidebar with ordinary route links, separate from global
app navigation, and a Base UI Dialog presented as a section drawer below 1100 CSS
pixels. Keep record search and capture outside it. Keep the visitor's wide sticky
story index; below 1100 use a non-modal update disclosure rather than a drawer.

The sidebar substantially improves wide desktop working space. It does **not**
solve the whole laptop/mobile density problem: both zoomed laptop sizes fall
below the measured sidebar breakpoint, and long-title mobile tasks still start
below the fold. The prototype also exposes existing zoom overflow in preferences.
Do not treat the measured design as implementation-ready or lower the breakpoint
without measuring the resulting working-column width.

## Prototype, method and evidence

Read #5 (including Decision (owner)), AGENTS.md, `docs/ui-components.md`,
`docs/ui-maintenance.md`, `docs/source-privacy.md` and
[the first discovery](5-trip-header-density.md). The same mock API, exact long
English/Dutch titles, three-sentence repeated summaries, dates in November 2054,
24 updates and 32 open tasks were reused. Empty trips keep title/dates and omit
summary/updates/tasks. No cover, production data, uploads or API changes.

Temporary React source replaced the trip shell only: context plus WorkspaceTabs
in a 224px sidebar; content in a `minmax(0,1fr)` column; compact 18px full title,
12px context padding; mobile context above a 44px drawer trigger. WorkspaceSearch,
Section and TripEditor remain in the content column, outside the responsive nav.
Drawer uses the existing `@/ui/dialog` adapter, localized existing messages,
Dialog.Title/Close, controlled open state and close on pathname change. At the
breakpoint only navigation changes presentation, never editor ownership.
The prototype breadcrumb repeats Trips and the full title; replace its plain
anchor/paragraph with the existing router breadcrumb in implementation.

Visitor prototype retains current title sizing, full summary and the existing
wide sticky index. Below 1100 it wraps the existing update index in an initially
closed native details disclosure **inside the Updates card**, after the summary.
This establishes geometry and anchor behavior; ship the owned Base UI Collapsible,
not the throwaway details control. Empty visitor pages have no chooser.

Playwright 1.64, bundled Chromium, Vite 8.3.5, Node 24.14.0 and pnpm 10.33.0,
frozen install. Same four physical viewports and Manifest V3
`chrome.tabs.setZoom(1.25 / 1.5)` extension as the first discovery; no CSS zoom,
DPR emulation or resized substitute. Readback at 150% returned 1.5 and a 390px
viewport reflowed to 260 CSS pixels, DPR 1.5. Matrix records CSS dimensions/DPR
for all 96 measurements: 3 surfaces × 4 sizes × 2 zooms × 2 fixtures × 2 locale/theme
pairs (English/light, Dutch/dark). Readback verification was a separate probe;
the matrix's zoom field is the requested zoom. At 125%, 1920 reflowed to 1536,
DPR 1.25. Other locale/theme pairings and cover variants are not proven.

The shared preview opened but two snapshots failed with “Preview automation
snapshot timed out after 15000ms.” Local Playwright/Chromium supplied the fallback.
Screenshots, scripts, source copies, profiles, registry source and raw JSON stay
outside Git at `/tmp/travel-sidebar-5/`; the zoom extension and original baseline
evidence are `/tmp/travel-header-5/`. These are ephemeral local review paths.
Representative wide English/light and narrow Dutch/dark captures were inspected.
The prototype source has been removed from the checkout before the PR.

## First useful content comparison

Same landmarks and units as the first discovery: rounded
`getBoundingClientRect().top × browserZoom` at scroll zero. Values are rendered
viewport pixels; compare with physical viewport height. Owner = Tasks accordion
trigger; visitor = overview/empty card. A top edge appearing does not mean a
whole card fits. Current/A/B are the **historical #87 measurements**, reproduced
without alteration; S is the new sidebar/drawer or visitor disclosure experiment.
Ranges span English/Dutch, not uncertainty intervals. Signed-out gate is outside
this trip-shell prototype; retain its existing comparison in the first document.

| Surface | Size      | Zoom | Empty y: current / A / B / S                      | Dense y: current / A / B / S                      |
| ------- | --------- | ---- | ------------------------------------------------- | ------------------------------------------------- |
| public  | 1366×768  | 125% | 596 / 478 / 478 / **596**                         | 596 / 478 / 533 / **596**                         |
| public  | 1366×768  | 150% | 704–786 / 569 / 569 / **704–786**                 | 704–786 / 569 / 629 / **704–786**                 |
| public  | 1280×800  | 125% | 591–659 / 477 / 477 / **591–659**                 | 591–659 / 477 / 529 / **591–659**                 |
| public  | 1280×800  | 150% | 779 / 567–622 / 567–622 / **779**                 | 779 / 567–622 / 626–681 / **779**                 |
| public  | 1920×1080 | 125% | 561 / 489 / 489 / **561**                         | 561 / 489 / 555 / **561**                         |
| public  | 1920×1080 | 150% | 732 / 580 / 580 / **732**                         | 732 / 580 / 651 / **732**                         |
| public  | 390×844   | 125% | 778 / 843–889 / 843–889 / **778**                 | 778 / 843–889 / 890–936 / **778**                 |
| public  | 390×844   | 150% | 934 / 1011–1067 / 1011–1067 / **934**             | 934 / 1011–1067 / 1068–1124 / **934**             |
| share   | 1366×768  | 125% | 653 / 535 / 535 / **653**                         | 653 / 535 / 590 / **653**                         |
| share   | 1366×768  | 150% | 773–855 / 638 / 638 / **773–855**                 | 773–855 / 638 / 698 / **773–855**                 |
| share   | 1280×800  | 125% | 648–716 / 534 / 534 / **648–716**                 | 648–716 / 534 / 586 / **648–716**                 |
| share   | 1280×800  | 150% | 848 / 636–691 / 636–691 / **848**                 | 848 / 636–691 / 695–750 / **848**                 |
| share   | 1920×1080 | 125% | 618 / 546 / 546 / **618**                         | 618 / 546 / 612 / **618**                         |
| share   | 1920×1080 | 150% | 801 / 649 / 649 / **801**                         | 801 / 649 / 720 / **801**                         |
| share   | 390×844   | 125% | 862–889 / 954–973 / 954–973 / **862–889**         | 862–889 / 954–973 / 1001–1020 / **862–889**       |
| share   | 390×844   | 150% | 1036–1069 / 1146–1169 / 1146–1169 / **1036–1069** | 1036–1069 / 1146–1169 / 1203–1226 / **1036–1069** |
| owner   | 1366×768  | 125% | 725 / 668 / 668 / **681**                         | 725 / 668 / 668 / **681**                         |
| owner   | 1366×768  | 150% | 910 / 802–847 / 802–847 / **818–849**             | 910 / 802–847 / 802–847 / **818–849**             |
| owner   | 1280×800  | 125% | 721 / 668 / 668 / **681**                         | 721 / 668 / 668 / **681**                         |
| owner   | 1280×800  | 150% | 910 / 802–847 / 802–847 / **818–849**             | 910 / 802–847 / 802–847 / **818–849**             |
| owner   | 1920×1080 | 125% | 768 / 668 / 668 / **367**                         | 768 / 668 / 668 / **367**                         |
| owner   | 1920×1080 | 150% | 887 / 802 / 802 / **441**                         | 887 / 802 / 802 / **441**                         |
| owner   | 390×844   | 125% | 1133–1143 / 1055 / 1173 / **954**                 | 1133–1143 / 1055 / 1173 / **954**                 |
| owner   | 390×844   | 150% | 1359–1371 / 1266 / 1407 / **1145**                | 1359–1371 / 1266 / 1407 / **1145**                |

### Dense visitor: first update

| Surface | Size      | Zoom | y: current / A / B / S                            |
| ------- | --------- | ---- | ------------------------------------------------- |
| public  | 1366×768  | 125% | 1385 / 1268 / 996 / **1154**                      |
| public  | 1366×768  | 150% | 1650–1732 / 1515 / 1179 / **1368–1450**           |
| public  | 1280×800  | 125% | 1378–1446 / 1264 / 991 / **1147–1215**            |
| public  | 1280×800  | 150% | 1723–1858 / 1566–1646 / 1174–1229 / **1441**      |
| public  | 1920×1080 | 125% | 1035 / 964 / 1029 / **1035**                      |
| public  | 1920×1080 | 150% | 1293 / 1141 / 1212 / **1293**                     |
| public  | 390×844   | 125% | 2817–3093 / 2928–3157 / 1638–1652 / **1589–1622** |
| public  | 390×844   | 150% | 3403–3739 / 3536–3817 / 1966–1982 / **1906–1945** |
| share   | 1366×768  | 125% | 1442 / 1324 / 1053 / **1211**                     |
| share   | 1366×768  | 150% | 1719–1801 / 1584 / 1248 / **1437–1519**           |
| share   | 1280×800  | 125% | 1435–1503 / 1321 / 1048 / **1204–1272**           |
| share   | 1280×800  | 150% | 1792–1927 / 1635–1715 / 1243–1298 / **1510**      |
| share   | 1920×1080 | 125% | 1092 / 1021 / 1086 / **1092**                     |
| share   | 1920×1080 | 150% | 1362 / 1210 / 1281 / **1362**                     |
| share   | 390×844   | 125% | 2901–3204 / 3012–3268 / 1736–1749 / **1673–1733** |
| share   | 390×844   | 150% | 3505–3874 / 3638–3952 / 2084–2101 / **2008–2080** |

## Findings and interaction verification

- **Content position:** wide desktop owner S is y=367/441 at 125/150%, versus
  current 768/887 and A/B 668/802. At 1366×768/125%, S=681 versus current 725;
  at 150%, S=818–849 still starts below the 768px fold. At 390×844, S=954/1145,
  better than current 1133–1143/1359–1371, but still below the fold. The full
  repeated breadcrumb and preferences cost space; there is no first-screen
  success claim for mobile. Visitor first-card positions are unchanged; mobile
  dense first article improves from 2817–3093 to 1589–1622 at 125% public, without
  the previous experiment's fixed 32px heading regression.
- **Breakpoints:** exactly 1099 CSS pixels gives static context plus drawer;
  1100 gives sticky context without a drawer trigger (browser-tested at 150%).
  At both zoom levels, both laptop sizes use the drawer: 1366/1.25=1093,
  1280/1.25=1024; at 150% they become 911 and 853. 1920 uses the sidebar at
  both zooms. The app retains its separate 680px global-nav breakpoint: a laptop
  can have a top app bar and trip drawer; a phone has bottom app nav and drawer.
  This distinction is intentional. Use CSS effective width, not device detection.
- **Sticky/overlap:** only the desktop trip aside is sticky (`top:16px`,
  `max-height:calc(100dvh - 32px)`, own vertical scrolling). After document scroll
  its measured top is 16 CSS pixels in both locales at 1920/150%, width 224.
  Its long context plus six links requires inner scrolling; later links are
  not all initially visible. Keep focus rings inside its padded scroll area.
  Global preferences/app header and breadcrumb scroll normally; Jump to is
  not another sticky layer. Desktop aside and content occupy separate grid
  columns. No owner desktop/laptop page-width overflow was measured.
  Visitor wide index retains its existing 24px sticky offset inside Updates;
  the narrow disclosure is in flow. No fixed top strip obscures anchor targets.
- **Mobile overflow is a blocker, not a pass:** all 24 mobile rows (including
  empty visitors) report page-wide overflow at effective widths 312/260. The
  original raw comparison also reports mobile overflow. The preference radio
  groups have an intrinsic minimum width; screenshots show clipped appearance
  controls and owner context at zoom. S does not fix that inherited shell issue.
  Fix wrapping/min-width in the first implementation slice, then remeasure all
  mobile columns; do not claim these geometric improvements prove readability.
- **Keyboard/names:** real 18-Tab walks in English/light and Dutch/dark at
  390/150% and 1920/150% recorded solid outlines on each focused control.
  Closed mobile order: selected language, appearance, four app links, capture,
  account, Trip details, Trip sections, Trips breadcrumb, Jump to, Tasks,
  New task, record actions. Desktop replaces the trigger with six native route
  links before breadcrumb/search. Full link names and `aria-current=page`
  survive. This is a changed keyboard sequence; no `tab`/`menuitem` semantics.
  Drawer is named by its localized Dialog.Title; it contains Close plus all six
  links, with 44px section targets. No unnamed icon-only section switcher.
- **Drawer focus:** Escape and explicit Close returned focus to the trigger in
  both locales at 390/150%. Selecting Story closed the drawer and changed the
  real section URL. A rapid synthetic Tab loop initially sampled focus guards,
  body and background controls; after allowing 100ms for focus management after
  each Tab, the English repeat stayed inside the popup throughout 16 presses.
  Treat rapid-key/assistive-technology focus timing as a validation risk; do not
  infer a universal focus-trap pass from axe. On successful route selection,
  recommend focus on the new section heading rather than relying only on
  trigger return; this prototype does not implement that announcement policy.
- **History:** mobile Prepare → drawer Story → Back → Prepare → Forward → Story
  passed in both locales. Opening/closing the drawer adds no history entry;
  Back is normal route navigation, not a drawer-close shortcut. Keep links
  openable/copyable and route state owned by the router. Viewport changes must
  close the drawer without pushing history; check resize while open in slice 3.
- **Dirty work:** with the React prototype mounted, both locales at desktop and
  mobile retained a synthetic Trip details draft after guarded Escape and after
  a blocked browser Back followed by Continue editing. Intentional discard
  returned focus to Trip details. This uses existing RecordDialog/Alert Dialog,
  not a replacement guard. A modal editor prevents opening navigation behind
  it; do not permit the drawer over a dirty editor. Keep Section, TripEditor,
  record focus/state and capture provider outside responsive nav branches.
  Task/document editors, locale changes, pending saves and resizing while dirty
  still need the full implementation journey suite; Trip details alone does
  not prove every record manager's lifetime.
- **Capture:** outside the closed drawer and unchanged by S. At 390/150%, Dutch
  capture is x=102.85, y=438.67, width=141.15, height=44 CSS pixels; bottom=482.67
  against a 563px viewport, leaving about 80px above the bottom app bar. English
  is x=128.30 with width=115.70. Names remain “Vastleggen in deze reis” /
  “Capture in this trip”. The open drawer intentionally blocks background
  capture until closed. A real keyboard/safe-area/touch check is still required.
- **Search/composition:** Jump to stays visible in the content column, neither
  duplicated nor hidden in the drawer. Searching “Synthetic preparation 24”
  returns the existing Prepare › Tasks record option in both locales, preserving
  section + record search. Keep account/preferences app-wide and the breadcrumb
  in content; don't add a second global sidebar. In implementation use a short
  current-section breadcrumb and a full title in trip context to avoid repeating
  the entire authored title vertically on phones.
- **Visitor navigation:** selecting update 24 in both public and share prototypes
  sets `#update-23`, focuses its existing `tabIndex=-1` target and leaves it at
  y=218 English / 188 Dutch CSS pixels at 390/150%. Back clears the fragment.
  Keep all 24 authored accessible anchor names, link-copy and initial deep links;
  opening the disclosure should not add history. No private fields are needed.
- **Axe:** four closed/desktop owner scans report only `page-has-heading-one`
  (the workspace title is the existing h2); both open drawer scans have zero
  violations. This is not an overall clean accessibility result. Give the
  workspace a real h1 in slice 1, then require no violations. Drawer focus tests
  and axe answer different questions.

## Component review and proposed design

Reviewed current [base-nova sidebar registry](https://ui.shadcn.com/r/styles/base-nova/sidebar.json)
and [Sidebar documentation](https://ui.shadcn.com/docs/components/base/sidebar),
[Base UI Drawer](https://base-ui.com/react/components/drawer) and
[Dialog](https://base-ui.com/react/components/dialog), against the installed
Base UI 1.9.0, pinned shadcn 4.22.1 and owned inventory. Raw registry source is
in the private local evidence directory.

Sidebar is a useful structural reference, but importing it wholesale brings
Sheet, tooltip, input, separator, skeleton and mobile-hook dependencies. Its
source includes cookie-persisted collapse state, icon-collapse sizing and a
Ctrl/Cmd+B shortcut. Those are unnecessary for six trip routes and risk
conflicting with editing. Keep persistent labeled links; do not introduce a
second global shell, cookie state, hidden icon rail or global shortcut. During
implementation compare/generate only the selected primitives using the pinned
CLI, record the owned composition and reasons in `docs/ui-components.md` and
the maintenance inventory, and run ui:check/ui:test.

Base UI Drawer supplies swipe and touch-specific behavior; Dialog supplies the
modal semantics needed for this small section chooser and already has an owned
adapter. Recommend **Dialog styled as a left sheet**, without swipe-only actions,
for the first implementation. Use Drawer only if the owner wants gestures and
its virtual-keyboard/snap behavior is tested; don't add it just for appearance.
Use a named title, visible unbroken Close label, scrollable content and Base UI
focus management. Keep RecordDialog exclusively for guarded record editing.
Visitor disclosure should use the existing Collapsible adapter, not a modal;
24 story anchors do not require trapping reading focus.

## Proposed small, mergeable implementation slices

Each slice is approval work under #5, not shipped by this PR. Merge independently
with existing behavior intact; keep #5 open until end-to-end acceptance. No new
infrastructure or separate repository deliverable was found. The gate/copy and
emergency-dialog observations remain tracked in #5, not silently dropped.

| Slice                                                   | Likely files touched                                                                                                                                                                                                          | Risk and bounded behavior                                                                                                                                                                                                                                                                 | Required tests before merge                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Establish a compact, zoom-safe trip context          | `src/Preferences.tsx`, `src/Boundary.tsx`, `src/trips/WorkspaceHeader.tsx`, theme tokens, `messages/en.json`, `messages/nl.json`, `e2e/owner.spec.ts`                                                                         | Low/medium. Fix preference minimum-width overflow, semantic h1, compact responsive full title and breadcrumb; keep existing horizontal section links. Remeasure before using S numbers as budgets. Coordinate signed-out gate scale/copy within #5, without adding a sidebar to the gate. | Playwright/axe both locales × themes, all four sizes and actual 125/150% zoom, empty/dense and cover/failed-cover; no clipping, full authored title accessible, no punctuation orphan.                                                                                       |
| 2. Add desktop trip sidebar without moving editors      | `src/pages/TripWorkspace.tsx`, `src/trips/WorkspaceTabs.tsx`, `src/trips/WorkspaceHeader.tsx`, owned workspace layout component, theme tokens, `docs/ui-components.md`, `ui-maintenance.json`, `e2e/owner.spec.ts`            | Medium. At 1100+ CSS px use 224px sticky trip context/navigation; retain existing mobile links until slice 3. No Section or editor remount on presentation changes. Preserve router links and search. Later sidebar links must be reachable by internal scroll.                           | Playwright/axe sidebar scroll/focus, 1099/1100 boundary, 1920 zoom positions near S, Story → Prepare → document editor, Jump to record activation; record-guard suite.                                                                                                       |
| 3. Replace narrow section links with Dialog drawer      | owned `src/trips/WorkspaceNavigation.tsx`, `src/ui/dialog.ts` only if adapter extension is needed, `src/pages/TripWorkspace.tsx`, theme tokens/messages, component inventory, `e2e/record-guard.spec.ts`, `e2e/owner.spec.ts` | Medium/high. One named trigger; state does not enter browser history; close on route/breakpoint change. Do not move TripEditor, managers or CaptureProvider into it. Specify heading focus after navigation and trigger fallback after dismissal/resize.                                  | Playwright/axe open/closed, slow and rapid Tab/Shift+Tab, Escape/outside/Close focus return, Back/Forward, deep link/new tab, resize while open/dirty, locale-switch drafts, deferred saves, record search, capture bounds; real mobile keyboard and safe-area manual check. |
| 4. Add responsive visitor update disclosure             | `src/ProjectionView.tsx`, `src/ui/collapsible.ts`, theme tokens/messages, `docs/ui-components.md`, `e2e/story.spec.ts`, visitor smoke specs                                                                                   | Low/medium; independently mergeable. Keep wide sticky index, full summary/title, unchanged projection payloads, and no chooser for empty trips.                                                                                                                                           | Playwright/axe public and share, update 24 by keyboard, initial fragment and Back, target focus/announcement, covers/failure, empty/dense, both locales/themes and real zoom. Compare first-card unchanged and first-article improvement.                                    |
| 5. Complete full journeys and remaining #5 observations | `e2e/owner.spec.ts`, `e2e/story.spec.ts`, `e2e/record-guard.spec.ts`, relevant emergency editor/dialog layout, decision docs and changelog                                                                                    | Validation plus bounded corrections. Resolve reported Dutch Sluiten splitting; verify trip/task/document drafts, dialogs/uploads and focus across new navigation. No payload/privacy expansion.                                                                                           | Full frontend checks and Playwright/axe; emergency editor at 390/125/150%, mobile capture with keyboard, title/summary/cover variants; manual screen-reader route announcements. Record new y budgets and evidence before closing #5.                                        |

Paths in the table are relative to `frontend/` unless under `docs/`. Proposed new
component names are illustrative; keep the repository's UI import policy.
All slices changing application copy require locale:audit/check/test in addition
to lint/format:check/build; shared UI changes require ui:check/ui:test. Run the
full Playwright suite and bundle budget for the combined implementation. The
first discovery's gate comparison remains the acceptance reference for that
separate signed-out surface.

## Checks for this documentation PR

Frozen frontend install and exact Node version; 96 real-browser-zoom measurements;
English/Dutch desktop/mobile keyboard, drawer dismissal/route history, dirty
Trip details Escape/Back and discard focus probes; 1099/1100 boundary probe;
record-search and public/share update-24/fragment Back probes; six owner axe
scans with the results above. No passing claim for untested mobile hardware or
screen readers. The restored application smoke/record-guard suite passed all 48 tests;
document formatting and `git diff --check` passed. Prototype source and evidence are excluded from
Git; only decision documentation and CHANGELOG.md belong in this change.

## Slice 4 result

Implemented the visitor Collapsible independently on `/trips/:slug` and
`/share/:token`. Below 1100 CSS px the index starts closed inside Updates,
after the complete summary. At 1100+ the original sticky index remains.
No projection fields, owner workspace files or authored text changed.

Synthetic 24-update fixture, same titles/summaries as discovery; values are
rounded first-article top × real browser zoom at scroll zero (English–Dutch
ranges). Old layout was restored with a temporary stylesheet showing the original
index and hiding the disclosure; no source was swapped. Chromium extension
uses `chrome.tabs.setZoom`, with CSS width/DPR recorded. First overview-card
positions are unchanged in all rows.

| Size | Zoom | Public old → new | Share old → new |
| --- | --- | --- | --- |
| 390×844 | 100% | 1780–1809 → 1112–1141 | 1848–1877 → 1180–1209 |
| 390×844 | 125% | 2817–3093 → 1589–1622 | 2901–3204 → 1673–1733 |
| 390×844 | 150% | 3403–3739 → 1906–1945 | 3505–3874 → 2008–2080 |
| 1366×768 | 100% | 870 → 870 | 916 → 916 |
| 1366×768 | 125% | 1385 → 1154 | 1442 → 1211 |
| 1366×768 | 150% | 1650–1732 → 1368–1450 | 1719–1801 → 1437–1519 |

Evidence stays outside Git at `/tmp/travel-slice4/` (48 old/new measurements
and screenshots, English/light and Dutch/dark). The inherited preferences
minimum-width overflow at 390px zoom remains assigned to concurrent slice 1;
this slice deliberately does not edit Preferences or Boundary. It remains
tracked in #5. These gains do not claim that articles fit above the fold.

Additional shared cover/failure/empty scans cover all four locale/theme pairs.
They exposed inherited dark-mode contrast on broken gallery-image alt text;
the gallery trigger now explicitly uses `text-travel-ink`. This correction stays
inside the visitor renderer. Keyboard + axe checks cover opening the disclosure,
all 24 names, target focus, initial fragments and Back at 1099/1100 CSS px.
## Slice 1 result

Implemented against `origin/main` 2684712. Preferences now constrain their radio
wrappers and wrap within the available width; the inherited 320px document
minimum is removed so 390px at 150% really fits 260 CSS pixels. The workspace
has a semantic h1 with the full authored title and h2 accordion titles (fixing
the pre-existing skip to record-manager h3 headings), plus a screen-reader h2
for the current section so overview cards also have a complete heading sequence, a short localized current-section
breadcrumb (the Trips ancestor uses exact active matching), 8px context padding,
6px workspace gaps and 4px title/context gaps. The responsive title is 24–28px;
its existing 24px mobile size is preserved. No truncation, sidebar, drawer,
visitor-page change or gate scale/copy change is included. Existing translated
section labels are reused, with no new message copy.

Same synthetic fixtures and Manifest V3 `chrome.tabs.setZoom` method as above:
32 owner measurements, empty/dense × English/light and Dutch/dark × four physical
sizes × 125/150%. All report no page-wide overflow, including effective 312/260px
phone widths. Values remain rounded Tasks-trigger top × zoom at scroll zero.
Empty and dense results agree; ranges span the two locales. Historical current
and A are retained for comparison; S is a different navigation prototype and is
not the slice 1 target.

| Size | Zoom | Historical current y | Historical A y | Slice 1 y (empty and dense) |
| --- | --- | --- | --- | --- |
| 1366×768 | 125% | 725 | 668 | 620 |
| 1366×768 | 150% | 910 | 802–847 | 745–790 |
| 1280×800 | 125% | 721 | 668 | 620 |
| 1280×800 | 150% | 910 | 802–847 | 745–790 |
| 1920×1080 | 125% | 768 | 668 | 632 |
| 1920×1080 | 150% | 887 | 802 | 745 |
| 390×844 | 125% | 1133–1143 | 1055 | 1005 |
| 390×844 | 150% | 1359–1371 | 1266 | 1329–1356 |

The phone improves over current, although the corrected 260px layout is later
than A's overflowing mobile measurement at 150%. Tasks still starts below the
phone fold. An initial 12px-padding/18px-gap implementation regressed to
1425–1452 at 150% after correcting the width floor; reducing spacing, rather than
shrinking the mobile title, recovered the improvement above.

Evidence stays outside Git at `/tmp/travel-slice-1/` (scripts, raw JSON and PNGs).
The automated owner matrix covers both locales × both themes, all four sizes,
312/260px effective widths, empty/dense (24 updates/32 tasks), loaded/failed cover,
full h1 names, current breadcrumb, no page overflow and axe including the
`page-has-heading-one` rule. Effective-width CI tests complement the separate
actual-zoom measurements; they are not claimed as browser zoom. Existing record
guard, capture and history journeys remain in the complete Playwright suite.
Real mobile keyboard and later navigation slices remain tracked in #5.

The unfiltered axe sweep also exposed the existing fading loading-status text
at insufficient intermediate contrast. Only decorative skeletons now fade; the
loading announcement stays fully opaque. Scans wait for Tasks and fonts to settle
and retain full violation details on failure.
