# Dutch/English translation drafts (#305)

The owner can ask for a machine-translated draft of a text a visitor can receive, to fill the language that
field is still empty in. The feature is an explicit action; it never translates on save, publishes, or replaces
authored text. Interface translations are separate (`interface-translations.md`).

## Dutch and English texts (#376)

Authored text a visitor can receive is stored in both languages, as `<field>_nl` and `<field>_en`, and the visitor
document delivers the one in the visitor's language, else the other (see [the domain model](domain-model.md)). The
draft feature is how the owner fills a language that is still empty; the stateless `POST /api/translation/drafts`
endpoint is unchanged and stores nothing.

- A draft is never stored by the API, the MCP tools or the backend: the owner reviews it and saves the record, and
  the saved text is an ordinary `<field>_<language>` write. Nothing is translated on save or on delivery, and a
  language the owner did not write is delivered as the other one, marked with `<field>_lang`.
- The editor fills the empty language of the field being edited (`LocalizedField`), keeps it marked as an
  unreviewed machine draft until the record is saved, and offers it only on the fields a visitor can receive. There
  is no **Add below the text**, and the buttons on owner-only fields (stay, route, location and visit notes, private
  notes, documents) are gone; their text is single-language and is never shared.
- Not stored: whether a text was machine-translated, and whether the other language changed since. Marking a
  translation as possibly out of date needs a timestamp per language per field and is not part of this change.

## Flow

1. A field with text in one language and none in the other offers one action, for the other language: **Draft
   from Dutch** or **Draft from English** (whichever has the text). Titles, names, captions and alternative text
   have it too. The field is the one on screen after the Dutch | English switch; a field with text in both
   languages, or in neither, offers nothing.
2. `POST /api/translation/drafts` (owner-authenticated) takes
   `{text, source, target}` with `nl`/`en`, at most 8 000 characters, and
   returns `{text, source, target, machine_translated: true}`. Nothing is stored,
   audited or logged. The cap keeps one held-open request under the 100 s
   Cloudflare allows for a proxied request on the Free plan (a 524 otherwise):
   about 170 characters/s plus a 15-30 s cold start. Longer text is rejected
   with a length error; the owner translates it in parts.
3. The draft goes straight into the empty language's field, under a notice "Machine-translated draft, not
   reviewed yet" with a review warning (place and dish names and idioms may be wrong). It is an ordinary edit of
   that field: the owner changes it, **Discard draft** empties it again, and nothing is stored until the record
   is saved, which also ends the notice. The other language's text is never touched.
4. Cancelling aborts the request. The backend checks for a departed caller
   before each piece and stops translating.

A failure (service not configured, unreachable, malformed answer) shows a
translated message with **Try again**; the field's text is unchanged. Cancelling aborts the request.

## Backend behaviour

`app/services/translation.py` talks to LibreTranslate's `POST /translate` with
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
- `TRAVEL_TRANSLATION_API_BASE` (unset disables the feature).
  `TRAVEL_TRANSLATION_API_KEY_FILE` names the mounted per-app credential sent as
  LibreTranslate's JSON `api_key`; a configured but unreadable or malformed file
  fails closed, never anonymously. Leave it unset only for a local engine without
  authentication.
- `TRAVEL_TRANSLATION_TIMEOUT_SECONDS` (120) is one total deadline for the whole
  owner request: queue wait, the on-demand cold start (about 15-30 s) and every
  piece. `TRAVEL_TRANSLATION_CONNECT_TIMEOUT_SECONDS` (5) bounds connecting.
- Redirects, proxy environment variables and automatic retries are disabled.
  Logs hold only fixed `translation_failed code=…` values and
  `translation_completed duration_ms=…`.

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
`app/services/media/ingest.py`). Waiting jobs stay `processing`; while a job of this
process is waiting it is not expired as stalled, and the stalled clock
(`processing_started_at`) restarts when the job gets its slot. A job lost with
its process still expires and can be retried.

## Reviewing translations after an edit

When both languages have text and one was edited later, the owner editor marks
the older version as possibly out of date. Saving an edit records the changed
language's timestamp. Editing both in one save gives them the same timestamp.
The editor also offers **Still correct**. Choose it and save to acknowledge the
other language's latest edit without changing the text. The reviewed timestamp
catches up to the other version so both are current. An unrelated save or a
save that echoes unchanged text leaves the timestamps alone.

Existing text starts with unknown edit order (both timestamps are null). The
first edit to either version establishes an order. A missing language has no
staleness warning. Moving a trip's text to its correct language carries the
timestamp with it. Machine drafts stay marked as unreviewed until saved.

Full owner API and MCP records expose `translation_freshness` keyed by field
name, with `nl_updated_at`, `en_updated_at` and `possibly_out_of_date` (the
language code or null). Owner update requests accept `<field>_reviewed` with
`nl` or `en`, for example `{"summary_reviewed":"en"}`. The private trip export
includes the same additive metadata for the localized records in the export.
Visitors continue to receive the stored text via the existing language and
fallback rules.
