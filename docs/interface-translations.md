# Contributing interface translations

Application copy belongs in `frontend/messages/nl.json` and `en.json`. Use typed
whole-message functions from `src/paraglide/messages.js`, and subscribe with
`useLocale()` in each rendering component. Dutch is the fallback. Use complete
messages for counts and interpolations; do not assemble translated sentences by
lowercasing labels or translating fragments. Keep message functions in enum maps,
validators and async notices; evaluate them during render in the current locale.
`useFeedback`, `textNotice`, `errorNotice` and `FeedbackError` retain that contract.
Browser history stores serializable message codes, never functions or translated
text. The destination translates the code when rendering.

API feedback uses stable codes, safe parameters and field paths. Unknown errors
use the translated operation fallback; raw server/provider/JavaScript diagnostics
and submitted values are never interface messages. See [API errors](api-errors.md).

Never translate authored titles, Markdown, captions, alt text, filenames, places,
packing names/categories or templates. App-created defaults and snippets use the
locale only at creation/insertion. Never recognize saved authored text by matching
it to a default. Keep ISO input values, endpoint timezones, date precision, numeric
payloads and integer grams unchanged. Display formatting uses `locale.tsx`/Day.js.
Keep route paths, anchors, auth callbacks, ownership, projection allowlists and
share privacy unchanged. Use the existing Travel tokens and Base UI controls.

## Repeatable audit

From `frontend/`, using `.node-version` and pnpm 10.28.2:

```sh
pnpm install --frozen-lockfile
pnpm locale:audit
pnpm locale:audit --all > /tmp/travel-interface-literals.txt
pnpm check
pnpm lint
pnpm format:check
pnpm test --maxWorkers=2
pnpm build
```

The audit compares catalogue keys, interpolation names, plural declarations,
selectors and each match branch. It catches visible JSX, copy attributes,
prose literals, template fragments and eager module-level `m` calls. Exact
source/value exclusions in `scripts/locale-audit.mjs` state their reason; do not
approve a component wholesale. CI runs this audit, generated type checks and
the full regression suite. Negative TypeScript assertions ensure generated
message keys and interpolation inputs remain typed. Plural regression tests
cover every plural message at 0, 1 and multiple, including authored interpolation.

The scanner is a review aid. The `--all` output includes single-word enum values,
CSS, selectors, ISO/Day.js patterns, URL/path fragments and other protocol literals.
Review it against the [source inventory](decisions/281-interface-translations.md),
including newly added production files. Trace dynamic strings through JSX,
attributes, validators, async fallbacks, stored notices, enum maps and offline
snapshots. A literal-free component can still render stale translated data.
Check module-level spreads of translated getter maps and writes to state/history.
Fix application copy; explicitly document authored/provider/static/protocol
exclusions. Test the audit itself when changing candidate detection or contracts.

Browser review uses fictional data, removed afterwards. Review signed-out/owner
shells, settings, record/discard dialogs, capture, library/media/publication, maps,
packing/offline reopening, public index/story/gallery and unlisted routes in both
locales and themes. Check 375 px layouts, keyboard entry/Escape/focus return,
accessible labels and status text. Switch with dirty editors, pending feedback,
selected uploads and focus. Verify authored data and submitted dates/numbers.
Record the checks performed and distinguish browser review from automated coverage.
No operational travel content belongs in Git.

## Exclusions

Catalogues contain application copy only. Authored fields, provider brands and
attribution, language autonyms, diagnostic-only text, legacy enum lookup keys,
styles, identifiers, formatting patterns and protocol examples are excluded.
The retired `dist/` archive is excluded and never published.

Generated `paraglide/` output is ignored and must compile from a clean checkout.
Test fixtures/helpers and styling/type infrastructure contain no production copy.
Static Dutch entry titles/descriptions are intentional no-JS fallback metadata;
runtime metadata changes in place. The manifest keeps `Travel`, `/admin/` start
URL/scope and fixed icons; locale switches do not rename an installed app.
The service worker caches the locale bootstrap for offline reopening.

Legacy emergency labels are compatibility lookup keys evaluated through messages.
Authored snapshot labels and text remain unchanged.
