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

## Theme coordination

Semantic tokens resolve through Travel tokens using `@theme inline`, including
background, foreground, surfaces, primary, border, input and ring. The generated
checkbox uses these without raw white/black utilities or an independent palette.
Root theme overrides therefore reach it and future portal components.

Light/dark/auto appearance comes from #278 (PR #280), the base of this change.
The root `data-theme` overrides feed the semantic tokens directly. Primary
foreground uses `travel-on-action` so checked icons retain contrast against
the light and dark action colours. No second theme system is introduced here.
