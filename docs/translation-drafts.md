# Dutch/English translation drafts (#305)

The owner can ask for a machine-translated draft of a long-form Markdown field
(trip summary, visit notes, reisupdate body, stay and route notes). The feature
is an explicit action; it never translates on save, publishes, or replaces
authored text. Interface translations are separate (`interface-translations.md`).

## Flow

1. The Markdown editor offers **Translate to English** and **Translate to Dutch**
   while the field has text. Short fields (captions, contact details) do not.
2. `POST /api/translation/drafts` (owner-authenticated) takes
   `{text, source, target}` with `nl`/`en`, at most 8 000 characters, and
   returns `{text, source, target, machine_translated: true}`. Nothing is stored,
   audited or logged. The cap keeps one held-open request under the 100 s
   Cloudflare allows for a proxied request on the Free plan (a 524 otherwise):
   about 170 characters/s plus a 15-30 s cold start. Longer text is rejected
   with a length error; the owner translates it in parts.
3. The editor shows a "Machine-translated draft" with a review warning (place
   and dish names and idioms may be wrong). The draft is editable; **Add below
   the text** appends it after the authored text, **Discard draft** drops it.
4. Cancelling aborts the request. The backend checks for a departed caller
   before each piece and stops translating.

A failure (service not configured, unreachable, malformed answer) shows a
translated message with **Try again**; the field's text is unchanged.

## Backend behaviour

`app/translation.py` talks to LibreTranslate's `POST /translate` with
`format: "text"`:

- Markdown structure is kept: heading, list, task and quote markers, code
  fences, horizontal rules, table rules and bare links stay as written; prose
  lines and table cells are translated. Inline syntax inside a sentence
  (`**bold**`, links) goes to the service as text and can come back altered,
  which the owner reviews.
- Lines are sent one piece at a time; a piece over
  `TRAVEL_TRANSLATION_SEGMENT_CHARACTERS` (1000) is split at sentence ends. Equal
  pieces in one request are translated once.
- The service is CPU-bound, so only one owner request is translated at a time;
  others wait for their turn.
- `TRAVEL_TRANSLATION_API_BASE` (unset disables the feature) and
  `TRAVEL_TRANSLATION_TIMEOUT_SECONDS` (120, per request; covers the cold start
  of the on-demand service, about 15-30 s, plus one piece).

The text goes only to the configured internal service. Errors carry no text,
URL or remote body, and the application does not log request bodies.

## Deployment

The service, its socket-activated lifecycle, resource limits and firewall rule
belong to `tjorim/apps` (#250 assessment, #252 implementation). Until
`TRAVEL_TRANSLATION_API_BASE` is set in the Travel service, requests fail with
`translation_is_not_configured`. Verifying `travel-api` to the proxy end to end
is tracked in apps#250.

## Video job concurrency

The same change serialises video derivative jobs (`VIDEO_CONCURRENCY = 1` in
`app/media/service.py`). Waiting jobs stay `processing`; while a job of this
process is waiting it is not expired as stalled, and the stalled clock
(`processing_started_at`) restarts when the job gets its slot. A job lost with
its process still expires and can be retried.
