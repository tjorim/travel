# Visitor built-release verification (#114)

Verified **2026-11-01**, following the method and limitations in
[the visitor fit-gap review](polarsteps-visitor-fit-gap.md). This is local
Chromium evidence, not a production performance or screen-reader certification.

## Release and fixture

Started from current origin/main. Installed the pinned Node 24.14.0 / pnpm
10.33.0 dependencies with the frozen lockfile and ran pnpm build. A dedicated
static server on localhost:4214 served dist's landing/public/share shells and
proxied /api to a dedicated FastAPI instance on :8114. No Vite development
server or API mocks were used for the release matrix. The static server mimics
the shell routing and share headers; this does not validate Caddy itself.

A fresh SQLite database and object store contain only invented content: three
rounded areas, two train routes, one visit, one stay, six updates with
0/1/3/8/1/0 approved abstract JPEGs, portrait/landscape/panoramic dimensions,
long Dutch titles and paragraphs, headings, lists and quotes. The publication
preview was checked before local publication and one-day named-link activation:
only deliberately selected records, no property/address/private-note fields,
no people, bookings, documents or live positions. No external publication.

Scripts, raw projection, database, capabilities, logs and PDFs remain outside
Git in /tmp/visitor-release-114. These are temporary local evidence, not
repository fixtures or durable CI artifacts.

## Matrix

Each row crosses **nl/en × light/dark × reduced motion on/off × public detail,
unlisted detail, / and /trips** (32 loads per row). Chromium DOM measurements
check document overflow and title/story positions; axe checks both detail
shells, and the first Tab checks the skip link and its outline. Evidence:
matrix.json / matrix.log in the private evidence directory, dated 2026-11-01.
All 256 loads passed document-overflow checks; all 128 detail loads had zero axe violations and a focused skip link. This is automated coverage, not a visual inspection of every permutation. A separate 64-load nl/en text/control clipping pass at all eight CSS widths found no clipped targets (excluding intentional photo-strip scrolling and map internals).

| CSS viewport | Scale | Evidence and result |
|---|---:|---|
| 1280 × 720 | 1 | Matrix DOM/axe/first-focus checks |
| 1440 × 900 | 1 | Matrix DOM/axe/first-focus checks |
| 1920 × 1080 | 1 | Matrix DOM/axe/first-focus checks |
| 820 × 900 | 1 | Matrix DOM/axe/first-focus checks |
| 390 × 844 | 1 | Matrix DOM/axe/first-focus checks |
| 360 × 800 | 1 | Matrix DOM/axe/first-focus checks |
| 853 × 480 | 1.5 | 1280 × 720 at 150% equivalent; matrix DOM/axe/first-focus |
| 640 × 360 | 2 | 1280 × 720 at 200% equivalent; matrix DOM/axe/first-focus |

The first update starts at y253–260 public / y309–316 unlisted on laptops, y337/393 at 820 px, y396/482 at 390 px and y426/560 at 360 px (nl/light/reduced motion). At 200% equivalent, the title remains above the fold (public bottom y140, unlisted y250); the unlisted first update at y452 is below the 360 px fold because of the saved-link notice.

Zoom equivalents reduce the CSS viewport as well as setting device scale
factor. Device scale factor alone does not exercise reflow. They do not replace
native browser zoom, OS text scaling or a real phone.

## Interaction and print evidence

On 2026-11-01, interactions.json records both real-API detail shells:
1280 × 720 sticky map positioning and follow-checkbox toggle; lightbox open,
ArrowRight, Escape and focus return to the last viewed photo; 390 × 844
Story/Map/Plan switching, touch tap and CDP touch swipe; deliberate blocking of
tiles.openfreemap.org/styles/* with readable route-in-words fallback.
These are browser-emulated touch events, not physical touch evidence.

The initial A4 PDF exposed print controls and omitted inactive-tab content.
Fixed with visitor-detail-scoped print styles: hide navigation, controls,
saved-link notice and map; show story and itinerary regardless of selected
tab; use readable light colours and wrap photo strips into a two-column grid.
The story and itinerary use a single column. Owner editors and owner previews
are outside the print scope. Regression tests cover both shells at 390/1280,
printing after selecting Map on phones, including a visible image.

Playwright page.pdf output for both shells was rendered with Poppler and
visually inspected, including story pagination, Markdown and itinerary.
PDFs have no browser-added URL headers. Browser print-dialog options and printer
drivers remain outside this check. Evidence: public.pdf, share.pdf and rendered
pages, 2026-11-01.

## Loading and delivery

Cold Chromium contexts, 390 × 844, reduced motion; CDP disabled cache, applied
150 ms latency, 200,000 bytes/s download, 100,000 bytes/s upload and 4× CPU
slowdown. Network.requestWillBeSent counted requests and loadingFinished summed
encodedDataLength, including external map traffic. Counts stop three seconds
after the first image load; they are not whole-trip scroll totals.

| Shell | Requests | Encoded bytes | First contentful paint | First photo load |
|---|---:|---:|---:|---:|
| Public | 26 | 820,022 | 5,068 ms | 6,076 ms |
| Unlisted | 26 | 820,494 | 4,676 ms | 5,588 ms |

Paint Timing supplies FCP. A capturing image load listener supplies first-photo
load after scrolling the first story image into view; this is load completion,
not measured photo paint. One sample per shell; static files are uncompressed,
with no CDN, TLS or production cache. These are rough diagnostics only.

Layout Instability entries excluding recent input sum to 0.02393 in each load,
not session-window CLS. A separate 1.5-second photo-response delay and traversal
of all 13 images recorded only the initial footer movement when loading content
was replaced; no additional image-load shifts. Existing image dimensions and
aspect-ratio reservation were retained. Evidence: load.json and shifts.json,
2026-11-01.

curl GETs of all four built shells confirmed generic brand Open Graph/Twitter
metadata; unlisted HTML has no-referrer and noindex/noarchive metadata and
no trip/capability interpolation. The local static harness supplies no-store,
private / no-referrer / noindex, noarchive headers on share responses.
This tests the local harness, **not VPS headers**; deployment remains
[tjorim/apps#219](https://github.com/tjorim/apps/issues/219).

## Limits and follow-up

Real phone browser over a secure origin, TalkBack, native browser zoom,
production performance and deployed Caddy headers were not verified. Headless
axe and keyboard checks do not substitute for assistive technology or human
visual review. No new out-of-scope defect was established; no duplicate issue
was opened. Physical-device acceptance in #114 remains explicitly unverified.

Local checks: lint, format:check, check, test (90 files / 640 tests),
locale:audit, ui:check, build and bundle:check. Affected Playwright suites cover
visitor print, accessibility, lightbox, story, context, top bar, metadata and
saved links; these regression suites use their documented mocked Vite setup,
separately from the real-API built-release evidence above.
