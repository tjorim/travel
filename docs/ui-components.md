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
| Spinner | Not applicable | Loading is announced as text in `role="status"` regions; a spinner would add no information. Progress is already Base UI (`PackingProgress`). |
| RecordDialog, field.tsx, SearchCombobox, SuggestInput, TravelTextarea | Keep (unchanged) | The #279 reasons still hold: no registry component covers dirty dismissal, Base UI Field validity wiring, grouped option adaptation or free-text Autocomplete. |
| Map and media rendering | Keep specialised | MapLibre and media or lightbox rendering have no registry equivalent. |

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
