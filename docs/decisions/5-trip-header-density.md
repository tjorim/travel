# Trip header density and navigation alternatives (#5)

## Follow-up

The owner subsequently selected the sidebar/drawer direction. See the measured
[second discovery](5-sidebar-drawer-prototype.md) for that prototype and proposed
implementation slices. The recommendation below records the first discovery.

## Status and recommendation

Discovery, 2026-10-31. **Awaiting the owner's choice; no layout is selected or
shipped by this document.** Based on `origin/main`
`8f5e654fb63baf26e035e474531527b87048e871`.

Recommend **compact existing context first, with a bounded visitor update
chooser**, rather than replacing the owner navigation architecture. The current
URL-based sections, record search, capture action and guarded editors are useful.
A full sidebar/command-centre redesign adds scope without evidence that it improves
preparation more than a smaller context header. The measured reordered owner
prototype improves section-link discovery but does not lower the task block.
Keep #5 open for the owner's direction and implementation; this is not completion
of its implementation or final validation criteria.

## Current journeys and sources

Read the complete issue, AGENTS.md, `docs/ui-components.md`,
`docs/ui-maintenance.md`, `docs/source-privacy.md`, decision 403 and current
`TripHeader`, `ProjectionView`, `Boundary`, `TripWorkspace`, `WorkspaceHeader`,
`WorkspaceTabs`, `WorkspaceSearch`, `SectionAccordion` and `PrepareSection`.
Public and unlisted pages share the projection renderer. Unlisted pages also
have device-copy context, so their first-content positions differ.

Visitor: preferences → all-public-trips link → full title/dates → overview →
update index → story. With 24 updates the wrapped index becomes a substantial
obstacle below the wide-screen sticky breakpoint. A visitor looking for update
24 should not have to read the whole index before reaching update 1.

Owner: preferences → global navigation/capture/account → breadcrumb → trip
context/details → six section links → Jump to → tasks/documents. Prepare has
32 synthetic tasks. Jump to now searches records locally as well as sections;
the older decision 403's section-only description is no longer current.
The same route registry handles deep links and record-dialog requests.

## Alternatives

|                            | A: compact existing components                                                                                                                        | B: restructure navigation                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiment                 | 32px visitor/gate heading, 24px owner heading; 12px text-panel padding, 8px header/workspace gaps; reduce header margins. Full titles remain visible. | Builds on A. Move visitor update anchors into an initially closed chooser immediately after title/dates; move owner section navigation before breadcrumb/context and wrap links rather than horizontal scrolling.                                                           |
| Preparation                | Same order and familiar URLs; less space before tasks, with no new interaction.                                                                       | Earlier section discovery, all six links visible; wrapped links consume additional height on phones. Task section is not necessarily earlier.                                                                                                                               |
| Reading                    | More summary visible, but a dense update index remains expensive.                                                                                     | Opening the chooser is an extra action; closed chooser removes 24 links from the initial keyboard path and exposes story sooner.                                                                                                                                            |
| Wider architectural option | Keep current shell.                                                                                                                                   | A persistent desktop sidebar and mobile section drawer could remove repeated top layers, but were not implemented or measured here. They need explicit owner selection, breakpoint/focus design and a fresh measured prototype; do not infer gains from these measurements. |
| Cost/risk                  | Low layout scope; heading hierarchy and pointer targets must survive.                                                                                 | Medium scope for measured reordering/chooser; high scope for sidebar/drawer, especially sticky regions, mobile overlap, history and editor lifetime.                                                                                                                        |

B deliberately retains native route links and anchors. It is not a tab-panel
rewrite. The throwaway chooser used native details/summary to establish geometry;
an implementation should use the owned Base UI Collapsible with a properly named
trigger and visible focus. No prototype source enters this change.

## Measurement method

Playwright 1.64 / bundled Chromium against Vite 8.3.5 on localhost, with
`frontend/e2e/mock-api.ts` and in-memory response overrides. No production calls.
Node 24.14.0 (matching `.node-version`), pnpm 10.33.0, frozen install.
A temporary Manifest V3 extension invoked `chrome.tabs.setZoom` at **1.25 and
1.5**. A probe read back 1.25 using `getZoom`; 1280 layout pixels reflowed to
1024 CSS pixels and DPR 1.25. Each matrix row also recorded innerWidth, innerHeight
and DPR. This is browser zoom, not CSS zoom, deviceScaleFactor or pinch scaling.

Sizes: 1366×768, 1280×800, 1920×1080 and 390×844. At 150%, the 390px
viewport has 260 CSS pixels. Dutch/dark and English/light were exercised in every
case; this pairing does not prove the other locale/theme combinations.
The no-cover fixture isolates text/header/navigation density. Cover-loaded and
failed-cover variants remain implementation acceptance work, not measured claims.

Both empty and dense fixtures use full long authored titles (English: “A slow
coastal railway journey through quiet harbours, forest villages and mountain
markets in Exampleland”; Dutch: “Een rustige treinreis langs de kust door stille
havens, bosdorpen en bergmarkten in Voorbeeldland”). Dense summaries repeat three
sentences about walking a harbour, taking a morning train and visiting a market
(roughly 400 characters); dense trips have 24 titled updates and 32 open tasks.
Empty trips retain the long title and dates but have no summary, updates or tasks.

Numbers below are **rendered viewport pixels from document top at scroll zero**:
`round(getBoundingClientRect().top × browserZoom)`. Compare them directly with
the height in the size column. They are top edges, not a guarantee that the whole
control/card fits. “First” is overview/empty-state card for visitors, the Tasks
accordion trigger for owners, and Sign in for the gate. Preferences, return links,
trip details and capture can be useful earlier; these are consistent working-content
landmarks, not claims that nothing above them is actionable. Ranges span English
and Dutch. Each cell is current / A / B. Gate has the same values for both fixtures.

### First working content/action

| Surface | Size      | Zoom | Empty y: current / A / B          | Dense y: current / A / B          |
| ------- | --------- | ---- | --------------------------------- | --------------------------------- |
| public  | 1366×768  | 125% | 596 / 478 / 478                   | 596 / 478 / 533                   |
| public  | 1366×768  | 150% | 704–786 / 569 / 569               | 704–786 / 569 / 629               |
| public  | 1280×800  | 125% | 591–659 / 477 / 477               | 591–659 / 477 / 529               |
| public  | 1280×800  | 150% | 779 / 567–622 / 567–622           | 779 / 567–622 / 626–681           |
| public  | 1920×1080 | 125% | 561 / 489 / 489                   | 561 / 489 / 555                   |
| public  | 1920×1080 | 150% | 732 / 580 / 580                   | 732 / 580 / 651                   |
| public  | 390×844   | 125% | 778 / 843–889 / 843–889           | 778 / 843–889 / 890–936           |
| public  | 390×844   | 150% | 934 / 1011–1067 / 1011–1067       | 934 / 1011–1067 / 1068–1124       |
| share   | 1366×768  | 125% | 653 / 535 / 535                   | 653 / 535 / 590                   |
| share   | 1366×768  | 150% | 773–855 / 638 / 638               | 773–855 / 638 / 698               |
| share   | 1280×800  | 125% | 648–716 / 534 / 534               | 648–716 / 534 / 586               |
| share   | 1280×800  | 150% | 848 / 636–691 / 636–691           | 848 / 636–691 / 695–750           |
| share   | 1920×1080 | 125% | 618 / 546 / 546                   | 618 / 546 / 612                   |
| share   | 1920×1080 | 150% | 801 / 649 / 649                   | 801 / 649 / 720                   |
| share   | 390×844   | 125% | 862–889 / 954–973 / 954–973       | 862–889 / 954–973 / 1001–1020     |
| share   | 390×844   | 150% | 1036–1069 / 1146–1169 / 1146–1169 | 1036–1069 / 1146–1169 / 1203–1226 |
| owner   | 1366×768  | 125% | 725 / 668 / 668                   | 725 / 668 / 668                   |
| owner   | 1366×768  | 150% | 910 / 802–847 / 802–847           | 910 / 802–847 / 802–847           |
| owner   | 1280×800  | 125% | 721 / 668 / 668                   | 721 / 668 / 668                   |
| owner   | 1280×800  | 150% | 910 / 802–847 / 802–847           | 910 / 802–847 / 802–847           |
| owner   | 1920×1080 | 125% | 768 / 668 / 668                   | 768 / 668 / 668                   |
| owner   | 1920×1080 | 150% | 887 / 802 / 802                   | 887 / 802 / 802                   |
| owner   | 390×844   | 125% | 1133–1143 / 1055 / 1173           | 1133–1143 / 1055 / 1173           |
| owner   | 390×844   | 150% | 1359–1371 / 1266 / 1407           | 1359–1371 / 1266 / 1407           |
| gate    | 1366×768  | 125% | 652–889 / 303 / 303               | 652–889 / 303 / 303               |
| gate    | 1366×768  | 150% | 732–983 / 363 / 363               | 732–983 / 363 / 363               |
| gate    | 1280×800  | 125% | 649–884 / 303 / 303               | 649–884 / 303 / 303               |
| gate    | 1280×800  | 150% | 709–944 / 363 / 363               | 709–944 / 363 / 363               |
| gate    | 1920×1080 | 125% | 652–889 / 303 / 303               | 652–889 / 303 / 303               |
| gate    | 1920×1080 | 150% | 782–1066 / 363 / 363              | 782–1066 / 363 / 363              |
| gate    | 390×844   | 125% | 564–609 / 526–572 / 526–572       | 564–609 / 526–572 / 526–572       |
| gate    | 390×844   | 150% | 676–730 / 630–686 / 630–686       | 676–730 / 630–686 / 630–686       |

### Dense visitor: first update article

This is the more demanding reading landmark after the summary and index.

| Surface | Size      | Zoom | y: current / A / B (English–Dutch range) |
| ------- | --------- | ---- | ---------------------------------------- |
| public  | 1366×768  | 125% | 1385 / 1268 / 996                        |
| public  | 1366×768  | 150% | 1650–1732 / 1515 / 1179                  |
| public  | 1280×800  | 125% | 1378–1446 / 1264 / 991                   |
| public  | 1280×800  | 150% | 1723–1858 / 1566–1646 / 1174–1229        |
| public  | 1920×1080 | 125% | 1035 / 964 / 1029                        |
| public  | 1920×1080 | 150% | 1293 / 1141 / 1212                       |
| public  | 390×844   | 125% | 2817–3093 / 2928–3157 / 1638–1652        |
| public  | 390×844   | 150% | 3403–3739 / 3536–3817 / 1966–1982        |
| share   | 1366×768  | 125% | 1442 / 1324 / 1053                       |
| share   | 1366×768  | 150% | 1719–1801 / 1584 / 1248                  |
| share   | 1280×800  | 125% | 1435–1503 / 1321 / 1048                  |
| share   | 1280×800  | 150% | 1792–1927 / 1635–1715 / 1243–1298        |
| share   | 1920×1080 | 125% | 1092 / 1021 / 1086                       |
| share   | 1920×1080 | 150% | 1362 / 1210 / 1281                       |
| share   | 390×844   | 125% | 2901–3204 / 3012–3268 / 1736–1749        |
| share   | 390×844   | 150% | 3505–3874 / 3638–3952 / 2084–2101        |

## Responsive interpretation

Do not ship the experimental 32px heading unchanged at every width: on 390px
mobile A makes the public first card **later** (843–889 versus 778px at 125%).
The current long-title responsive scale is already smaller there. Preserve that
mobile scale and compact the surrounding context instead. B's wrapped owner
navigation also pushes the task trigger later on mobile (1173 versus A's 1055px
at 125%). Prefer the existing horizontal section links plus Jump to until a
measured mobile disclosure wins. The recommended direction combines these
findings; neither throwaway prototype is a ready-to-ship design.

## Interaction findings and implementation requirements

A preserves DOM order and existing link names. In B, owner section links move
before the breadcrumb and Trip details; this is a changed keyboard sequence,
not just a visual rearrangement. At 390px/150% Dutch, a 25-Tab walk reached
Start, Reizen, Bibliotheek, Instellingen, Vastleggen in deze reis, Account,
Overzicht, Plan, Voorbereiden, Inpakken, Verhaal, Delen, Reizen, Reisgegevens,
Ga naar, Nog te regelen32, Nieuwe taak and the task view/complete buttons.
All these recorded a solid outline. Keep the 44 CSS-pixel section targets;
do not recover space by shrinking tap targets or hiding full accessible names.

The visitor chooser's closed state skips its anchors in keyboard navigation;
when opened, all 24 anchors retain their titles and fragments. At 390px/150%
Dutch, selecting update 24 set `#update-23` and placed the target at y=188 CSS
pixels within the viewport. The temporary summary had the browser's automatic
outline; production should use the owned focus token and a localized trigger.
An anchor scroll succeeding is not proof of screen-reader focus transfer:
explicitly verify target focus/announcement in implementation. Keep the existing
`tabIndex=-1` targets, browser Back and link-copy/open-new-tab behavior.

Mobile capture remains the existing fixed button above the bottom app bar.
At 390px/150% Dutch its box was x=102.85, y=438.67, width=141.15, height=44
CSS pixels: bottom=482.67 against a 562.67 CSS-pixel viewport, leaving 80px.
Its accessible name was “Vastleggen in deze reis”. B must not move it into a
closed drawer or beneath the section links. Recheck with the virtual keyboard,
safe-area insets and a real touch device; desktop Chromium is not that evidence.

Neither experiment changes editor code. The unchanged baseline smoke and
record-guard suites passed **48 tests**, including both locales' Back/Forward
and reload recovery, owner section journeys, capture and axe checks. These do
not establish that moving React components in a future implementation preserves
drafts. Retain mounted accordion contents and existing RecordDialog/Alert Dialog
ownership, guarded Escape, locale-switch draft retention and intentional-discard
focus return. Do not key/remount editors when switching a navigation presentation.

The gate benefits strongly from A's heading scale; it does not need an owner
workspace sidebar. Keep the full heading and terminal punctuation together where
possible. Review the archive introduction as a separate copy decision within #5:
prefer fresh-launch language describing trips created in the application, with
no implied automatic archive import. No copy changes are approved here.
For the reported Dutch `Sluiten` break, allow dialog title/action rows to wrap
between controls and keep action words unbroken; test the existing emergency
editor at both zoom levels. This matrix did not open that editor, so the reported
break is not claimed fixed or newly verified.

## Component review

Reviewed the owned inventory/maintenance guidance and fetched current
`base-nova/tabs.json`, `base-nova/navigation-menu.json` and Base UI's
[Collapsible documentation](https://base-ui.com/react/components/collapsible)
for this discovery (local reference copies outside Git).

- [shadcn Tabs](https://ui.shadcn.com/docs/components/tabs) switches panels.
  Keep WorkspaceTabs' native router links and `aria-current=page`; tabs semantics
  would misrepresent routes and lose ordinary link behavior.
- [Navigation Menu](https://ui.shadcn.com/docs/components/navigation-menu)
  supplies flyout navigation; six direct section links need no flyouts. A sidebar
  is a responsive composition, not a reason to adopt menu/menuitem semantics.
- Base UI Collapsible already backs SectionAccordion and supports the visitor
  chooser. Preserve `keepMounted` where drafts exist. Plain disclosure is simpler
  than introducing modal focus trapping for a list of story anchors.
- Existing Popover handles account focus return; RecordDialog supplies dirty
  guards; SearchCombobox/AsyncSearchSelect retains Jump to's record/section search.
  Retain those owned adaptations. No new primitive or maintenance-baseline update
  is warranted by this docs-only experiment.

If the owner chooses a mobile drawer, review the generated Sheet/Dialog against
RecordDialog and mobile focus restoration before adoption. Document any new
custom composition in `docs/ui-components.md` during implementation, with the
inventory/import-policy and locale checks required by AGENTS.md.

## Bounded sequence after the owner chooses

1. Record the owner's actual choice in #5; keep discovery recommendation distinct
   from approval. Implement compact title/context and gate spacing first, using
   named tokens and complete English/Dutch messages. Preserve the #4 return links.
2. If approved, add the visitor disclosure using Collapsible, retain all anchors
   and wide-screen reading context; avoid putting a 24-link list before the first
   article on narrow effective widths. Re-measure the empty and dense cases.
3. Only if the owner selects broader owner navigation, build a separate measured
   sidebar/mobile disclosure prototype before changing the route shell. Preserve
   search, capture, section URLs, history and dialog lifetimes. The measured B
   reordering is not sufficient evidence to ship a full navigation redesign.
4. Validate both themes × both locales, cover/no-cover/failure, mobile keyboard,
   task creation/completion, record search, Story → Prepare → document editing,
   dirty dismissal, focus return and the emergency editor's `Sluiten` label.
   Run the required frontend checks and publication-safety review if visitor
   payloads ever change. This proposal requires no payload/permission changes.

Acceptance examples: at both laptop sizes and zoom levels, full title and
context remain available while the first working action is reachable without
traversing six stacked navigation layers; the empty trip exposes its create or
empty-state action; update 24 is reachable by a named keyboard-operable chooser;
all six owner sections remain URL links; capture stays visible on 390px mobile;
long Dutch dialog actions do not split words. Set numeric implementation budgets
with the owner using these baselines; the prototypes do not yet meet every
first-screen goal, particularly at 150% and on mobile.

Implementation remains tracked in #5, under parent #9; no unrelated infrastructure
or privacy deliverable was discovered and no duplicate implementation issue is
needed before the owner selects scope. Do not close #5 with this PR.

## Evidence and checks

All scripts, fixture overrides, extension/profile, raw JSON and PNG screenshots
are outside Git at `/tmp/travel-header-5/`. Names encode surface, physical
viewport, zoom, locale, density and alternative. Evidence is synthetic and local;
the directory is ephemeral and should be copied to private review storage if
needed after this workspace is removed. It is not a permanent repository link.
Reviewed representative laptop visitor and mobile owner captures for title
wrapping, whitespace and navigation position. The interaction capture can be
scrolled after the keyboard walk; matrix measurements use scroll zero.

Checks: frozen frontend install; exact Node version; translation generation;
Playwright measurement matrix; targeted mobile keyboard/anchor/capture probe;
`playwright test e2e/record-guard.spec.ts e2e/smoke.spec.ts --workers=2`
(48 passed); docs formatting and `git diff --check`. No shipped source, fixtures,
payloads or layout changed, so no application build or backend tests were needed.
