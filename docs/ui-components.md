# Shared UI generation (#279)

CLI 4.21.0 init with explicit `--base base --preset nova` wrote `base-nova`,
`iconLibrary: lucide`, `rsc: false` and Tailwind v4’s empty config path.
Aliases now target the existing `src/ui/` layout; TypeScript resolves `@/*`.
The generated helper re-exports the existing `cn` package; there is no second
class helper. CLI font, palette, animation and runtime dependencies were
removed. Travel keeps its CSS layers and font, adding only Lucide.

Generate only what is needed with the command in AGENTS.md. Review source,
replace arbitrary values with named tokens and run lint, formatting, tests
and build. Do not bulk-generate or blindly overwrite wrappers.

## Maintenance

Dependabot updates the underlying packages (Base UI, Lucide and
react-day-picker) through `package.json` and the lockfile. It does not update
the copied component source in `src/ui/`. Updating the pinned shadcn CLI also
does not rewrite existing components.

For dependency updates, review release notes against the primitives we use,
run the frontend checks, and verify keyboard operation, field validation,
calendar selection, dirty-dialog dismissal and focus return. Include both
locales and themes at narrow widths in the browser smoke and axe checks.
Run test, build and end-to-end commands sequentially: their translation
generation writes to the same ignored `src/paraglide/` directory.

When an upstream shadcn fix affects a component we use, compare its registry
source with our implementation and merge the relevant behavior manually.
Preserve Travel tokens, translations and the wrapper decisions below. Do not
overwrite all components merely to match the latest registry.

| Existing control | Decision | Reason |
| --- | --- | --- |
| TravelCheckbox | Replace with generated checkbox; keep API wrapper | Same Base UI primitive and controlled API; Lucide replaces the glyph. Wrapper retains explicit-label handling, size and focus treatment. |
| field.tsx | Keep | Base UI Field/Fieldset connect labels, errors and legends to field validity; registry layout helpers do not replace this integration. |
| SearchCombobox | Keep | Adapts option/optgroup children and rich grouped choices to the existing searchable-selection API. |
| SuggestInput | Keep | Free-text Autocomplete and application event handling differ from selection-only combobox behaviour. |
| TravelTextarea | Keep | Field.Control supplies field validation and ref integration rather than a plain textarea. |
| ChoiceGroup | Keep | Typed compact radio-button choices preserve labelled arrow-key navigation and the view-change API. |
| Date, time and date-time inputs | Replace with `DateField`, `TimeField`, `DateTimeField` | Native inputs draw in the browser's locale. The fields use generated Popover and Calendar (react-day-picker), restyled with Travel tokens; see decision 293. |
| RecordDialog (Dialog and Alert Dialog) | Keep | Dirty-dismissal confirmation, async submission, nested dialogs and focus return are application behaviour beyond generated presentation shells. |

## Registry review of application compositions (#469)

Checked against the `base-nova` registry
(`https://ui.shadcn.com/r/styles/base-nova/<name>.json`) and Base UI 1.9 with
CLI 4.21.0. A component name alone was not a reason to replace anything; a
custom control stays when the registry version would drop a requirement.

| Composition | Outcome | Evidence |
| --- | --- | --- |
| EmptyState | Extend: `ui/empty.tsx` generated, `EmptyState` kept as the API wrapper | The registry `empty` supplies the Empty / Title / Description slots. Owned adaptation: a `section` with the Travel card surface, an `h2` title and a `p` description (the registry renders `div`s, which lose the heading), left-aligned like the cards around it. The unused media and content slots and the `class-variance-authority` dependency were dropped. |
| Lazy-view loading placeholder | Extend: `ui/skeleton.tsx` generated | The three hand-written pulsing bars are now `Skeleton`, tokenised to `bg-travel-media-bg`, `rounded-travel-control` and `motion-reduce:animate-none`, and `aria-hidden`. The wrapper keeps `role="status"` and the delayed fade-in. Status-text loading cards stay: they carry the only accessible message. |
| Account menu (Boundary) | Replace with the generated Popover | It was a Collapsible with `role="menu"`/`menuitem`, a hand-written Escape and outside-press listener and manual focus return, yet held a paragraph and one button, which is not a menu. `Popover` provides outside press, Escape, focus return and collision handling. The panel now anchors under the trigger at every width instead of floating above the bottom bar on narrow screens. |
| ChoiceGroup | Keep | Registry `toggle-group` renders `aria-pressed` toggle buttons that can be deselected. The choices here (language, appearance, packing group and filter) are required single selections, so Base UI `RadioGroup` semantics and arrow-key navigation are correct. Not turned into optional toggles to match a component name. |
| WorkspaceTabs, app navigation, overview section chips | Keep | Registry `tabs` is a panel switcher (`role="tab"` plus `tabpanel`) driven by component state. These are router links where the URL decides what is open and `aria-current="page"` marks it; `role="tab"` would misreport them and break opening a section in a new tab. `navigation-menu` is for flyout menus, which there are none of. |
| Pagination | Not applicable | No screen pages records; lists render whole or by section. Add the registry `pagination` if one ever does. |
| Spinner | Adopt (`src/ui/spinner.tsx`) | Registry `spinner` (Lucide `Loader2Icon`) restyled to Travel tokens: always `aria-hidden`, `motion-safe:animate-spin` so it stays still under reduced motion. It sits beside text that keeps the announcement. See "Spinner" below. Progress is already Base UI (`PackingProgress`). |
| RecordDialog, field.tsx, SearchCombobox, SuggestInput, TravelTextarea | Keep (unchanged) | The #279 reasons still hold: no registry component covers dirty dismissal, Base UI Field validity wiring, grouped option adaptation or free-text Autocomplete. |
| Map and media rendering | Keep specialised | MapLibre and media or lightbox rendering have no registry equivalent. |
| Visitor `PhotoLightbox` | Keep custom composition | One Base UI Dialog per gallery, restyled as a dark full-bleed viewer (#228): named Previous/Next Buttons (`focusableWhenDisabled`, so focus is never dropped at an end), ←/→ keys, a pointer-event swipe on touch and pen only (48 px, mostly horizontal, `touch-pan-y` so vertical scrolling is untouched), a "Photo n of m" status, the caption as an overlay near the bottom and `finalFocus` returned to the last photo's trigger. It has no language switch: a delivered alt text and caption have no translation, so there is nothing to switch to (the language stays in the page preferences). No registry carousel fits a modal with approved-derivative preloading. |

Provenance: `empty.tsx` and `skeleton.tsx` came from
`pnpm dlx shadcn@4.21.0 add empty skeleton --yes`, then were reformatted and
restyled as above. Before adding a new custom control, check the registry
(`pnpm dlx shadcn@4.21.0 search`, or the JSON endpoint above) and Base UI for a
supported component or variant, and record the outcome here.

## Theme coordination

Semantic tokens resolve through Travel tokens using `@theme inline`, including
background, foreground, surfaces, primary, border, input and ring. The generated
checkbox uses these without raw white/black utilities or an independent palette.
Root theme overrides therefore reach it and future portal components.

Light/dark/auto appearance comes from #278 (PR #280), the base of this change.
The root `data-theme` overrides feed the semantic tokens directly. Primary
foreground uses `travel-on-action` so checked icons retain contrast against
the light and dark action colours. No second theme system is introduced here.

## Visual foundations and visitor listings (#493)

The listing keeps native router links rather than adding a control. The existing
registry Card is a surface composition, not a navigation primitive; Base UI does
not supply a trip-grid layout. `travel-trip-grid`, `travel-trip-card` and
`travel-listing-state` therefore own the responsive editorial composition while
retaining native link keyboard behaviour. Cards use typography and a restrained
gold top edge instead of an empty image box: no cover or private media is fetched.
Shared surfaces no longer stack borders and shadows; interactive inputs retain
their separate boundary tokens. Reading width, grid spacing, card padding,
section spacing and the future cover ratio have named Tailwind tokens.

The existing route-and-sun favicon is retained, with forest, paper and gold
colours aligned to the light palette. All four HTML entries use the same SVG.

Verification: the complete 57-test Playwright smoke/axe suite passed; the
13 listing cases passed again after capping visible titles at four lines (the
full text remains the accessible link name). The listing matrix covers Dutch
and English, light and dark, and 360 / 820 / 1920 px, with synthetic long,
unbroken and missing titles. Each matrix case saves `listing.png` under its
`frontend/test-results/listing-listing-*` directory for visual review. Reviewed
wide light and narrow/tablet dark captures for gutters, wrapping, focus rings,
quiet metadata and sparse-card balance. Loading, empty, error and retry are
covered separately. Lint, format:check, build and diff whitespace checks passed.
No application messages or publication fields changed.

## Trip covers and visitor story layouts (#494)

The cover choice is a toggle `Button` (with `aria-pressed`) in the copy's detail
view, beside the existing presentation and approval actions; no new control or
picker was needed. The visitor header (`TripHeader`) is a custom composition:
shadcn/Base UI have no page-header or hero primitive. It keeps a native `img` in a
`figure` and falls back to a text-only panel with the listing cards' gold accent
when there is no cover or it fails to load. `travel-aside-split` and
`travel-story-split` are named Tailwind utilities because the arbitrary grid
columns they need are rejected by the lint rule; their widths are theme tokens
(`--spacing-travel-aside`, `--spacing-travel-story-nav`), as is the hero ratio
(`--aspect-travel-hero`). The in-page story navigation stays a native `nav` list
of anchors, sticky beside the timeline on wide screens. The visitor lightbox is the
existing Base UI Dialog. Gallery thumbnails use one 4:3 crop with the owner's focal
point; the full image remains in the lightbox.

## Visitor hero, mosaic and lightbox (#228)

No new primitive: shadcn/Base UI have no hero, image mosaic or full-bleed viewer, so these
stay custom compositions on native elements and the existing Base UI Button and Dialog
(`@/ui/dialog`).

- **Hero (`TripHeader`).** With a cover, the title, dates and destinations sit over a
  full-width cover (a compact band on a phone, `--spacing-travel-hero*`, that scrolls away).
  The title is first in the document and the photo is stacked behind it in one grid cell;
  the caption stays a `figcaption` under it. A hugging scrim (`travel-hero-scrim`, tokens
  `--color-travel-hero-ink` and `--color-travel-hero-scrim`, the same in both themes)
  keeps the text readable on any photo: `e2e/story.spec.ts` measures it over a pure-white
  cover at 360 and 1440 px, light and dark, Dutch and English (about 6.6:1, AA is 4.5:1).
  Without a cover, or when it fails to load, the header is today's text block. A preview
  that is still loading the cover shows the forest-green placeholder behind the text. When
  printed, the photo and scrim are dropped and the text prints as ink.
- **Mosaic (`Gallery lead`).** Replaces the sideways strip and its paging arrows. One photo
  stays one large frame; two sit side by side, the first larger; three or more are a large
  first photo over tiles in rows that always fill the width (3, 2 or 3+2, never one alone).
  Every photo is visible and is its own button (named by its alt text), and a count pill
  states how many there are (`visitor_photo_count`). Tiles show no inline caption (the
  lightbox does); a video keeps its own full-width frame under the photos. Row heights and
  the pair's height are theme tokens (`--spacing-travel-mosaic-*`).
- **Map tab (`TripMap bare`).** Below 1100 px the map drops its card and shows its heading
  to assistive technology only, and the canvas grows to most of the window
  (`--spacing-map-phone-canvas`). Beside the story (≥1100 px) it keeps the card and heading.

## Owner workspaces (#495)

No new interactive primitive was needed: trip cards are native router `Link`s (the
whole card is the link, so it opens in a new tab and keeps keyboard behaviour), the
state label is plain text with a decorative dot, and the publication state is a text
badge, not a control. `HomeTripCard`, `ListTripCard`, `TripStatePill` and `TripCover`
are therefore custom compositions: the registry `card` is a surface and `badge` a
chip, neither adds behaviour, and the surfaces reuse the Travel tokens. `WorkspaceTabs`
and the app navigation keep their router-link decision (see #469) and only change
styling: the selected item has an underline instead of a filled tab. `TripCover`
fetches the owner's `cover_url` with the session through `OwnerImage`, renders nothing
when there is no cover, and is decorative (`alt=""`) because the title sits beside it.

`travel-main-split` (main column plus the 26 rem context column) and
`travel-overview-split` (three stacked blocks beside one tall block) are named
utilities for the same reason as `travel-aside-split`: arbitrary grid columns or rows
are rejected by the lint rule. `--spacing-travel-owner-max` caps owner pages.

Verification: `e2e/owner.spec.ts` renders the home, trip list and workspace in Dutch
and English, light and dark, at 360 / 820 / 1920 px with synthetic long, unbroken and
missing-cover trips, asserting no horizontal overflow and no axe violations, and
saves `owner.png` under `frontend/test-results/owner-owner-*`. Reviewed the wide
light, wide dark and narrow/tablet captures for gutters, wrapping and contrast. The
full 148-test Playwright suite (smoke, axe, listing and story specs, which cover the
public and shared pages unchanged by this work), 493 unit tests, lint, format:check,
locale audit, build and the bundle budget passed.

## Dependency and upstream source maintenance

Use the pinned CLI and review workflow in [ui-maintenance.md](ui-maintenance.md). Existing generator/version examples above describe the original adoption; current maintenance commands and captured revisions live in that workflow and the frontend inventory.

## Local primitive exports

`src/ui/button.ts`, `input.ts`, `collapsible.ts`, `progress.ts` and `dialog.ts`
re-export the existing Base UI APIs unchanged. Screens use `@/ui/...`; these
adapters introduce no styles, wrappers, default props or interaction changes.
The custom `RecordDialog` remains the inventoried direct composition for guarded
editors. The thin primitive exports are intentional; replacing them with fully
styled registry defaults would change Travel's existing design and is not part
of import alignment.

### Unsaved record guards (#12)

The existing Base UI RecordDialog/Alert Dialog composition also supplies the
router-level confirmation; no new control is needed. RecordForm uses the Base UI
FieldSet disabled contract and an inert content wrapper while saving, including
custom editor content. Dialog dismissal waits for the request. Inline
useRecordForm consumers (including publication settings) register with the same
router blocker.

Audited consumers: TripEditor, CaptureDialog, AreaManager, LocationManager,
StayManager, RouteManager, VisitManager, TripTaskManager, TravelUpdateManager,
DocumentManager, DocumentLibraryManager, EmergencyInfoManager, MediaManager
(derivative/presentation forms), and PublicationManager (public/link forms).
All shared RecordForm consumers previously disabled only Submit and could lose
post-submit edits on reset/success; the pending contract now covers all of them.

Back/Forward and internal route changes require explicit discard; pending writes
must finish first. Reload/close uses the browser's native unload warning. Because
mobile browsers can skip it, JSON-only drafts are recovered from tab-scoped
session storage when the same owner, path and saved baseline are reopened.
Recovery never submits automatically. Intentional in-app departure, reset,
successful save and sign-out clear the snapshot. File selections cannot be
serialised and must be selected again after reload; authored non-JSON values are
never stored. Drafts are not retained after the browser closes the tab.

## Responsive visitor update index (#5, slice 4)

The existing Collapsible adapter supplies the narrow update chooser. It is a
non-modal disclosure inside Updates after the summary; native anchors retain
full authored names, fragment URLs and browser history. The wide sticky index
remains at 1100 CSS pixels. CSS hides the inactive presentation; the closed
Collapsible panel does not expose duplicate anchors. No new primitive or custom
control is needed (Base UI Collapsible was reviewed in the #5 discovery).
## Compact owner context (#5, slice 1)

WorkspaceHeader keeps its existing custom page-header composition: the registry
has no page-header primitive. Its full authored title is now an h1, with a named
responsive typography token and compact context padding. The native router
breadcrumb uses the existing localized current-section label instead of repeating
the title. Horizontal route links and editor ownership stay unchanged. ChoiceGroup
keeps Base UI RadioGroup keyboard behavior; its wrapper and group now constrain
intrinsic width so the existing wrapping works at zoomed phone widths.

SectionAccordion titles now wrap the existing Collapsible trigger in an h2,
connecting the workspace h1 to manager h3 headings without changing the button
or mounted-panel behavior.

## Desktop trip sidebar (#5, slice 2)

Reviewed base-nova sidebar and Base UI Navigation Menu against shadcn 4.22.1
and Base UI 1.9.0. Keep an owned CSS composition in TripWorkspace,
WorkspaceHeader and WorkspaceTabs (inventoried as TripWorkspace).
The registry sidebar brings collapse cookies, an icon rail, a global shortcut,
Sheet and other unused dependencies. Navigation Menu supplies flyouts; these
six destinations are ordinary router links, with full localized names and
aria-current=page, rather than tabs or menu items.

One context/navigation subtree becomes a 224px sticky column at 1100 CSS px,
with a 16px top inset, viewport-bounded internal scrolling and padded focus
rings. Below it, the existing horizontal section navigation stays unchanged.
The sibling content uses minmax(0,1fr); search, Section and TripEditor keep
their React ownership across resize. Capture and CaptureProvider remain in
the existing app boundary. No matchMedia branch, second landmark, cookie,
shortcut or global shell is introduced. The breadcrumb remains before the
workspace in normal reading order. Sidebar title size and geometry use named
Tailwind tokens; existing messages supply all labels.

## Narrow owner section drawer (#5, slice 3)

`WorkspaceNavigation` owns a Base UI Dialog left sheet below 1100 CSS px,
using the existing `@/ui/dialog` API. Reviewed base-nova Sheet source
(https://ui.shadcn.com/r/styles/base-nova/sheet.json) against installed Base UI
1.9.0 / pinned shadcn 4.22.1: it already uses Dialog, but its generated icon-only
Close, palette, animation and extra styled Button are unnecessary here.
Keep the owned composition with Travel tokens, localized visible Close/title
and native WorkspaceTabs route links (44px targets, current-page semantics).
Base UI Dialog explicitly supports positioned sheets without gestures.
The existing section/Close messages supply whole localized names.

Only navigation switches subtrees. The desktop sidebar links/styles stay
unchanged. One section nav is exposed when wide or when the drawer is open;
closed narrow navigation exposes only its named trigger. Editors, managers,
search and capture remain outside the responsive branches. Modal editors make
the background trigger inert. Open state is local and never written to history.
Dismissal returns focus to the trigger; crossing to wide returns it to the
current sidebar link. Successful same-tab selection focuses the stable localized
section h2 after the router updates; selecting the current link does so directly.
Modified clicks retain native new-tab behavior. Back/Forward remain router-owned.

## Motion and feedback (#94)

Layers and controls answered nothing: dialogs, the section drawer, popovers and
suggestion lists appeared and vanished at once, buttons had no hover or press
state and the map camera ignored a reduced-motion request. Base UI marks a layer
that is entering or leaving with `data-starting-style` and `data-ending-style`
and waits for its transition before unmounting, so the motion lives in four
named utilities in `src/tailwind.css`:

| Utility | Used by | Motion |
| --- | --- | --- |
| `travel-backdrop-motion` | Record, alert and lightbox dialog backdrops, the drawer backdrop | 150 ms opacity |
| `travel-popup-motion` | Record, alert and lightbox dialog popups | 160 ms opacity and 200 ms rise; a bottom sheet below 620 px rises further |
| `travel-drawer-motion` | The narrow trip section drawer | 220 ms slide from the left |
| `travel-menu-motion` | The generated `Popover` (customised locally) and `SuggestInput` lists | 120 ms opacity and a 4 px drop |

Buttons and `action-link` lift on hover (`brightness-110`), nudge 1 px on press
and ease their colours over 150 ms; `secondary` and `danger` controls tint
instead. Every transition has a `prefers-reduced-motion` guard, and the map's
`easeTo` and `flyTo` calls no longer set `essential: true`, so MapLibre skips
them for visitors who ask for reduced motion. `e2e/motion.spec.ts` checks both
settings; the other end-to-end checks run with reduced motion so axe never
samples a half-transparent dialog. Nothing here changes which controls exist,
their names, focus return or the dirty-edit guards.
## Photo-led story updates (#94)

A visitor's update used to read heading, meta, text and then a grid of small
thumbnails. It now reads like a story first seen as pictures: the date and place
line and the heading, then the update's photos as a strip, then the text. This is
a restyle of what the audience already receives, never new content.

- `Gallery` takes `strip`. One photo fills a frame up to 42.5rem wide; several
  are a row that scrolls sideways, snaps to each photo and shows the next one
  peeking (`basis-5/6`, two thirds from 680 px), so the row reads as scrollable
  without arrows. Each photo is still the existing `SharedImage` button that opens
  the lightbox, so keyboard use, captions and alt text are unchanged. Videos fill
  the frame width. Loose gallery photos keep the grid.
- A row of several photos has Previous photo and Next photo arrows (44 px, hidden at the ends of the row, scrolling by four fifths of its width) for mouse users, for whom a sideways scroll bar is easy to miss; touch, keyboard focus and the scroll bar still work.
- A "3 days later" line sits above an update whose story date and the previous
  one's are both given to the day (`daysLater`, derived from dates the audience
  already has; shown for a gap of a day or more, never for month or year dates).
- Photo triggers brighten slightly on hover, with no motion for visitors who
  prefer reduced motion.

Not copied from Polarsteps: likes, comments and names of viewers (there are no
viewer identities, see the fit-gap analysis).

## Map beside the story (#94)

On a screen 1100 px or wider, a visitor's trip with an update that has a shared
place puts the map in a sticky column beside the story instead of above it
(`travel-story-map`, the map in `data-story-map`). The story's own index folds
into its disclosure at every width, since the map and the timeline now share the
space. There is still one `TripMap`; narrower screens keep the old order.

- **Follows the reader.** `useActiveUpdate` watches the updates with an
  `IntersectionObserver` and, only while the map is beside the story, reports the
  one the reader has reached. `TripMap` takes it as `follow`: it rings that point
  and eases the camera to it, without opening the point's card or changing the
  selection. The ease is not marked essential, so a reduced-motion visitor gets a
  jump.
- **Photo markers.** `photos` pins the first approved photo of an update at the
  point its shared area already has, one per place. Markers are buttons added with
  `maplibregl.Marker`; a click or tap scrolls to the update. They are hidden from
  assistive technology (`aria-hidden`, `tabindex=-1`) because the map is a single
  image role and a control inside it cannot be reached; the point buttons under
  the map already link to the same updates. Only the image inside a marker is
  scaled: the `scale` property composes outside MapLibre's `transform` and would
  scale the marker's offset too.
- **Visitor control.** A checkbox under the map, "Move the map along with the story" (on by default), stops and resumes the follow, so a visitor who wants to look around alone is never fought by the camera.
- Nothing new is delivered: markers and follow use the projection's photos and
  area points. The publication safety check has a line for the pin.
## Plan stepper and first steps (#94)

Two small additions for planning on a laptop, both built from existing controls:

- **Nights stepper.** A stay that is still an idea or planned shows "− N nights +"
  in the Plan list. It moves only the check-out date by one night (never below
  one night, disabled while a save is pending) and says so in the section's status
  line ("Stay now runs 1 Mar → 4 Mar."). A confirmed or cancelled stay is edited in
  its dialog, so a booking's dates never change from a quick tap. A stay set to "everyone" or "custom" is edited there too: a change to it reaches visitors as it is saved, so it should not happen from a tap. Both buttons are
  44 px square with whole-sentence accessible names. Visits already had Move up and
  Move down, so no drag-and-drop is added: it would not be keyboard operable.
- **First steps.** A trip with no area, visit, stay or route shows "Start with where
  you are going" on its overview with three links into the Plan blocks (places, a
  stay, a route). It appears only after all three lists have loaded, so a loading
  trip never flashes it, and it disappears with the first record.

## Narrow owner Sharing and Capture (#112)

Reuse the existing Base UI Collapsible, Button and date/time adapters. Sharing's
visibility summary wraps below its title on phones; per-item controls are unchanged.
Capture owns a sticky Save/status row within its scrolling form so explicit saving
stays reachable without a second action or a new primitive. Its date/time adapter
opts into stacked phone fields; other date/time consumers keep their layout.

## Photo-first phone Capture (#233)

Capture now opens on the trip's photos, one line (the update's required title) and
Save; the trip underway (else the next upcoming, else the last captured into) and the
time now are prefilled. The language switch, connection status, the full private-by-
default explanation, date and time, private note, photos already in the trip's library
and the location fold under "More".

No custom control stays: the folded section is the existing Base UI Collapsible
adapter (`@/ui/collapsible`, trigger and panel as in `SectionAccordion`), photo
choosing is a Base UI `Button` that opens a hidden Base UI `Input type="file"`
(`multiple`; a second one with `capture="environment"` for the camera, offered only
for coarse pointers), grouped with `FieldSet`/`FieldLegend`. shadcn and Base UI have
no file-picker or thumbnail-grid component to adopt; the thumbnail tiles are plain
Tailwind with a Base UI `Button` to take a photo out. The private-by-default
sentence stays beside Save in a short form (`capture_private_short`) and in full in
More; the sticky Save bar keeps both in view.

The one addition to the shared dialog is `RecordDialog`'s `keyboardFit` (a lift and
height from `window.visualViewport`, applied as the `sheet-fit` utility) and
`localeControl={false}`: phone browsers shrink only the visual viewport when the
keyboard opens, so a sheet pinned to the layout viewport would put Save under the
keys. Other dialogs are unchanged.

## Compact visitor shell (#104)

Reuse the owned Base UI Popover for the visitor Preferences disclosure and
ChoiceGroup (Base UI RadioGroup) for Story / Map / Plan below 1100 px.
The registry Popover and Base UI radio controls support these interactions;
no new primitive or dependency is needed. Keep the existing preferences
persistence and closed update Collapsible. The map follow checkbox sits before
the map so it remains reachable in the sticky column.
The Preferences Popover module loads on first use, keeping the visitor entry
inside its existing bundle budget; the initial trigger remains keyboard accessible.

## Visitor keyboard path

On `/trips/<slug>` and `/share/<token>`, in DOM order: the "Skip to the story" link (visible only when focused; present when the trip has updates), the navigation bar's brand link, back link and Preferences disclosure, the header, the Story / Map / Plan choice on narrow screens, the story (update index, photo buttons, strip arrows), the map follow checkbox, the map canvas (arrow keys pan it, Tab leaves it), zoom and attribution, then the map's view buttons and the point and route buttons, which remain the keyboard and screen-reader route to each place. The skip link moves focus to the story region (`#story`). Every control shows a 3 px `travel-focus` ring (map controls and canvas included, inset where the map clips). Headings inside authored Markdown are fitted below the heading they sit under (`fitHeadings`), and the map's heading is an h2 on visitor pages.

## Visitor update context (#109)

`UpdateContextBlock` in `ProjectionView.tsx` is a compact, labelled `<section>` of
plain text rows (a tinted card with a list), placed under an update's text for the
approved stays, visits and routes that `groupStoryContext` (`src/visitor-context.ts`)
ties to that one update by shared area and day. It is read-only text with an existing
Directions link, so no Base UI or shadcn primitive applies; it adds no dependency.
Records the projection cannot tie to exactly one update keep their existing sections.


## Owner phone header (#111)

Use the existing Base UI Popover adapter for the single secondary-controls menu
(language, appearance, trip details and account). A dialog menu is appropriate
for embedded radio groups; a command Menu would require custom keyboard handling
for these form controls. Reuse WorkspaceNavigation's Base UI Dialog for sections.
The phone trigger composes the trip title and current section into one 56 px bar;
full title remains available as a heading and in Trip details. Desktop keeps
its existing sticky sidebar; preferences now live in Account at every width (#133). Capture stays above the bottom nav;
extra bottom padding lets the final content scroll clear of the floating action.

Composition decision: compared a wrapped preferences/context stack with a
two-line title/section trigger plus one secondary menu. Selected the latter
for M0: it preserves the existing drawer and Capture without adding another
navigation model. Concept: `[Trip title / Current section ▾] [Account ⚙]`,
with Capture floating above the existing app navigation.


## Shared top bar (#133)

VisitorTopBar composes brand and optional detail back links with the lazy
Preferences disclosure on landing, index, public/unlisted details, unavailable
and error states, the signed-out owner entry and callback. Plain anchors work
across the visitor/owner router boundary and in error fallbacks. The saved-link
notice remains outside the navigation. No visitor data projection changes.

PreferencesPanel owns the Base UI Popover surface and the existing LocaleControl
and AppearanceControl for both CompactPreferences and the owner Account menu,
on desktop and phone. The existing registry Popover supports this composition;
no new primitive or dependency is needed. Full-width preference rows are removed.
Keyboard order is brand, optional back link, Preferences; Escape returns focus
to its trigger. Detail skip links precede the bar.

## Alert (#137, item 1)

Generated base-nova Alert, then replaced registry palette/variant machinery with
Travel help/form-error tokens and cn. Info and success share the existing positive
notice treatment; error uses the existing error surface. Role defaults to status;
callers explicitly preserve alert for assertive errors. No aria-live override,
automatic dismissal, icons or new copy. Empty status regions retain help's empty
layout rule.

Converted form errors in fields, MarkdownField and TranslationDraft, owner home
loading/error cards and the visitor empty projection. Kept field-level validation,
media loading/progress, connection banners, counters and interactive translation
status rows bespoke: these have field associations, changing media state or inline
controls rather than standalone notices. Other manager notices remain for a later
consumer audit rather than mechanically changing every live region.

## Badge (#137)

Owned base-nova Badge retains Base UI useRender/mergeProps and span default,
including render composition for overview list items. Travel outline/live/offline
variants preserve booking-count and publication-state colours, sizing and text.
Unused registry link/destructive variants and cva are omitted. No live region
or interactive semantics are added.

PublicationState and TripOverview booking counts use Badge. TripStatePill stays
a quiet uppercase text label with a dot, without a capsule background. Stay and
route idea/planned/status and record visibility stay in their existing inline
metadata sentences: separate capsules would fragment those compact summaries.
Navigation links, provider connection notices and progress indicators retain
their existing link, status and progress semantics.

## Toggle and Toggle Group (#137, item 3)

Generated base-nova Toggle and Toggle Group (Base UI), then replaced the cva
variants, size scale and spacing context with the existing Travel secondary
compact button look; a pressed item fills with the action colour through
`data-pressed`. The group is a labelled `role="group"` ("Map view") of three
independent items (`multiple`), so each keeps `aria-pressed`, disabling until the
map is ready and its existing "on" suffix. The map's own handlers still apply
terrain, satellite (and the building tint) and globe, and keep their translated
error notices. "Show whole trip" is an action, so it stays a plain Button beside
the group. No new copy beyond the group label.

## Tabs (#137, item 4)

Generated base-nova Tabs (Base UI), then replaced the cva list variants with the
segmented Travel look the visitor view switch already had (bordered pill, paper
tabs, action-colour active tab through `data-active`). Replaces the Story / Map /
Plan `ChoiceGroup` in `ProjectionView`: the list is a labelled `tablist` with
automatic activation on arrow focus, Home and End, and each view is a `tabpanel`
associated with its tab. ChoiceGroup stays for the other single-choice controls,
and the owner section navigation stays link-based.

Below 1100 px inactive panels use Base UI's hidden/inert state and stay mounted
(`keepMounted`), so the map and story keep their state. From 1100 px the story and
map sit side by side and the tab list is hidden, so `ViewPanel` removes the panel
semantics (role, hidden, inert, tab stop, label) rather than expose a tabpanel
without a tablist; a `matchMedia` subscription follows window resizes. No new copy.

Bundle: Base UI Tabs and its composite runtime add about 7.7 kB raw (2.7 kB gzip) to
the visitor entries (579.4 to 587.1 kB raw, 193.2 to 195.9 kB gzip, measured on
`main` and this branch with the same dependencies), so their raw budget in
`bundle-budget.json` rises from 585 to 590 kB; gzip limits are unchanged.

## Switch (#137, item 7)

Generated base-nova Switch (Base UI), restyled to the Travel tokens: one size, the
checkbox's focus outline and invalid border, `bg-input` track and an action-colour
checked track. It replaces the checkbox on the visitor "Move the map along with the
story" control, the only real immediate on/off preference. The label, `Field`/
`FieldLabel` wiring and translation are unchanged; the control now reports
`role="switch"` instead of `checkbox`.

The remaining checkboxes stay checkboxes: they are form values saved with a record
(sharing address or time, packing flags, linked documents), selections from a list
(merge, reuse, media, scope fields) or confirmations (merge acceptance, no expiry
date), where "checked" means "included" rather than "this setting is on".

Bundle: the visitor entries went from 589.3 to 587.0 kB raw (196.9 to 195.9 kB
gzip), because the visitor entry no longer needs the checkbox; the admin entry is
unchanged.

## Spinner (adopted) and separator (#137, item 8): separator not adopted

- **Spinner**: adopted from the registry (`pnpm exec shadcn add spinner --yes`, base-nova).
  Local changes: the registry's `role="status"` and `aria-label="Loading"` are dropped
  (the glyph is `aria-hidden`; the translated text next to it, inside the existing
  `role="status"` region or the pending button, is the announcement), and the rotation is
  `motion-safe:animate-spin`, so with `prefers-reduced-motion: reduce` the glyph is a
  static ring. It is used beside the text, never instead of it, in: the pending label of
  every `RecordForm` submit button (`forms/fields.tsx`), the owner view loading line in
  `lazy-view.tsx` (the delayed Skeleton below it stays), the Markdown preview loading line,
  the visitor photo and video loading lines in `ProjectionView.tsx`, the library and
  emergency information loading lines, and the owner home loading card. Skeletons stay
  where a layout placeholder is the better fit. `e2e/spinner.spec.ts` checks the pending
  button and a loading status in both locales and themes, with and without reduced motion.
- **Separator**: the dividers are `border-t`/`border-b`/`divide-y` utilities on the
  items they separate (list rows, the sticky capture bar, the header rule, the
  collapsible route section). They are styling of the item, not standalone
  elements; swapping them for a separator element would add DOM and a `role="separator"`
  that screen readers announce in lists, for no behaviour gain, and `divide-y` rows
  cannot take one without changing list semantics.

Revisit the separator if a standalone divider between sibling regions (such as a toolbar
group) appears.

## Public index cover cards (#229)

Reviewed the pinned shadcn `card` registry item: it supplies structural wrappers,
not link or image-loading behavior; Base UI has no card interaction primitive.
Keep the existing TanStack whole-card link, with a native image and a reserved
16:9 frame, approved alt text/focal point and text-only failure fallback. No
nested interactive control or new UI adapter is needed.

## Story rows: photo strip and preview action (#234)

The travel update rows keep the existing Base UI `Button` for the preview action and
add a custom thumbnail strip (`trips/UpdatePhotos.tsx`): shadcn has no thumbnail-strip or
avatar-group item that loads authenticated blobs, and Base UI has no media primitive.
The strip is a plain list of fixed-size tiles (`OwnerImage`, now with a `lazy` option that
waits for an `IntersectionObserver` before fetching) and a "+N" tile; the preview reuses
`PreviewDialog` and `RecordDialog` rather than a second dialog.

## Advanced disclosure (#241)

`src/forms/AdvancedSection.tsx` is a composition of the existing Base UI Collapsible
adapter (`@/ui/collapsible`), styled like the `scope-group` disclosures of Sharing. shadcn and
Base UI offer no "advanced options" component beyond Collapsible. It holds the controls most
owners never touch: the trip dates and the `custom` record lists of an audience editor, and
*Dates for visitors*, *Show the time* and *Also share the address* in the visit, stay and
location editors. It starts closed only when nothing inside differs from the default, opens by
itself when something does (a stored choice is never hidden), and never closes by itself; its
trigger is a button with `aria-expanded`, reachable by keyboard and screen reader, and the panel
stays mounted so form state is kept.

## Alternatives panel and comparison (#238)

`trips/alternatives/` composes existing controls only. A group is a `role="group"` container with
Base UI `Button`s; "Choose this one" and "Dissolve group" reuse `DeleteConfirmation` (the Base UI
Alert Dialog behind `RecordDialog.tsx`) with the `ChoiceGroup` radio group for "cancel or remove
the others"; the member editor is a `RecordDialog` with `Field`/`FieldSet`/`TravelCheckbox`, as in
the merge dialog. The side-by-side comparison is a native `<table>` with column and row headers
(`CompareTable.tsx`): neither shadcn nor Base UI has a table primitive that fits, and a plain
table gives screen readers the cell-to-header relation. After a choice, focus moves to the group
(`tabIndex={-1}`), because the button that opened the confirmation is then disabled. A notice with
Undo sits in a `role="status"` region beside the group.

## Day menu in the agenda (#240)

Each day of the owner agenda has an "Add" control (`DayAddMenu` in `trips/AgendaView.tsx`) that offers
"Add a visit on this day", "Add a stay from this day" and "Add a route on this day". It is the
Base UI Menu, adopted through the generated shadcn `dropdown-menu` (`src/ui/dropdown-menu.tsx`,
trimmed to the menu, trigger, content and item, with Travel tokens and the `travel-menu-motion`
transition). A menu is the right semantics here: the trigger carries a day-specific accessible
name, the items are commands rather than form content, and the menu brings arrow-key navigation,
typeahead, Escape and focus return. A `Popover` of buttons (the account menu pattern) was
rejected for that reason, and three buttons per day would add up to dozens of tab stops on a long
trip. The dialogs it opens are the existing record dialogs; no dialog was built for this.
The Menu adds about 13 kB gzip to the owner bundle (926 to 939 kB); the total budget in
`bundle-budget.json` was raised to 945 kB with it. Bundle size is not a reason to avoid a registry
component: raise the budget with the change that needs it and say why.

On the map, the same three commands are links in the selected point's detail panel (the
existing `MapLink` buttons), so no new control was added there.

`trips/HomeLink.tsx` is a styled router `Link`, a plain text link with the 44 px target the other
text links use. It joins the two homes of documents and of sharing; see
[the decision note](decisions/240-create-in-place-and-duplicate-homes.md). No shadcn or Base UI
component covers a router link.

## Sharing preset picker and review dialog (#241, step 3)

`trips/publication/PresetSection.tsx` composes existing controls only. The preset choice is the
`ChoiceGroup` (Base UI `RadioGroup`): the presets are required single choices, with *Same as the
public page* as an extra first choice only for a hidden link that does not exist yet, so registry
`toggle-group` (deselectable `aria-pressed` buttons) is still the wrong semantics, as in the
`ChoiceGroup` entry above. The review is a `DeleteConfirmation` (the Base UI Alert Dialog behind
`RecordDialog.tsx`): a decision that needs an explicit *Apply*, cannot be dismissed by an outside
click and nests inside the link and collection editors like the widening dialogs do. It gained
three props for this, kept in the shared component rather than a second dialog: `wide` (a wider sheet
whose content scrolls), `confirmTone` (`primary` for a reviewed change that does not widen; the
default `danger` stays for deleting and widening) and `returnFocus` (focus goes back to the
*Review preset* button, which stays enabled after an apply for exactly that reason). The lists of
records inside it are `Collapsible` disclosures (the `scope-group` look of Sharing), open when six
or fewer. The widening acknowledgement is the same `TravelCheckbox` inside a `Field` as every other
widening dialog. `PresetExceptionsList.tsx` is a plain list of `Button`s: its actions only change the
editor's scope through the controls that already exist (tick, untick, exclusion), so no new write path
and no custom control. Visible button text starts with the accessible name's words (WCAG 2.5.3),
which the Dutch copy had to be changed for ("Verberg", "Toon").


## Local flight line suggestion (#242)

Checked the `base-nova/button.json` registry and the owned Base UI Button
adapter (`src/ui/button.ts`): the existing command button already fits.
Reuses the existing shadcn/Base UI Button adapter and the existing route-line
editor. This is a button command with explanatory text and a status region;
no new primitive or custom control is needed. Only the draft changes, so the
record dialog's existing Save and discard guard remain the review boundary.

## Finished-track review (#243)

Reuses Base UI Input (native file and number types), Field/Fieldset, Button
and the existing MapLibre editor. The base-nova input/field/button registry
and Base UI Input support these controls; no new primitive is needed. The
inline file-portion/draft composition stays custom because registry forms do
not implement transient binary requests, abort or explicit apply-before-save.
