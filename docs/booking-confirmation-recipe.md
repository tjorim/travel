# Booking confirmations with your own assistant

Use this recipe to turn a hotel, flight or train confirmation into a draft stay
or route. You give the confirmation to your own AI assistant, which is connected
to Travel's MCP server. The assistant drafts the records through the batch
create and document tools; you review them in the app. The original
confirmation is kept as a private trip document.

Travel has no paste box or upload form for confirmations and no inbound email
address. Booking intake is manual entry plus this recipe (decision D1 in
[the Polarsteps fit gap](decisions/polarsteps-fit-gap.md)). Everything the
recipe touches stays owner-only.

## Where it runs today

Production routing for MCP is still tracked in
[tjorim/apps#226](https://github.com/tjorim/apps/issues/226). Until it lands,
your assistant starts a local server itself. That server is development-only:
it needs `TRAVEL_ENVIRONMENT=development` and a subject that owns the trips in
the database it reads. Register it as a local stdio server. In Claude Code:

```bash
claude mcp add travel \
  -e TRAVEL_ENVIRONMENT=development \
  -e TRAVEL_MCP_DEVELOPMENT_SUBJECT=owner-local \
  -e TRAVEL_DATABASE_URL=sqlite:////path/to/copy-of-travel.db \
  -- uv run --directory /path/to/travel/backend python -m app.mcp_server
```

Other clients take the same command, arguments and environment. Set the
subject to the `owner_subject` of the trips in that database; `owner-local` is a
placeholder. The [backend README](../backend/README.md#owner-mcp-server) has the
stdio details.

The recipe writes records. Try it on a copy of your database first.

## The tools

The assistant starts from `list_trips` and `get_trip_overview`, which are always
listed. It finds every other tool with `search_tools` and runs it with
`call_tool`. Each search result says whether a tool reads or writes and whether
it needs `confirm=true`.

| Purpose | Tool | Notes |
|---|---|---|
| Find the trip | `list_trips` | Returns the trip ids. |
| Find areas | `list_areas` (`trip_id`, `query`) | Returns the area ids that stays and routes use. |
| Keep the confirmation | `upload_document` | A trip document. `document_kind` is `booking`. Returns the document `id`. |
| Draft stays and routes | `batch_create` | `payload.stays` and `payload.routes` in one all-or-nothing call. Returns compact rows with the new ids. |
| Read back | `get_stay`, `get_route`, `list_documents` | |
| Correct a draft | `update_stay`, `update_route` | |
| Remove a draft | `delete_stay`, `delete_route` | Need `confirm=true`. |
| Change who can see it | `set_visibility` | Needs `confirm=true`. The assistant does not call it unless you ask. |

Use `upload_document` for the trip's document. `upload_library_document` stores
a reusable owner-wide document and is not the recipe's tool. A search for
"upload trip document" returns both.

Creating stays and routes and uploading a document need no confirmation. Any
call that changes who can see something, publishes, or deletes data needs
`confirm=true`, given only after you have reviewed the target.

## Required fields

**Stay** (`create_stay` payload, also used in `batch_create`):

- **Where:** either `area_id` alone, while the accommodation is undecided (the
  stay then uses the area's shared city-level location), or a `location` with a
  name or an address, a city or an area. Give one or the other, not both.
- **Nights:** `check_in_date` and `check_out_date`. The check-out date is the
  departure morning; the stay covers the nights before it.
- **Status:** see [Status](#status-idea-planned-or-confirmed). Defaults to `planned`.
- **Optional:** `check_in_time` and `check_out_time` (only when the confirmation
  states them), `property_name`, `booking_reference`, `contact_details`, `notes`
  and `website_url` (https only).

**Route** (`create_route` payload, also used in `batch_create`):

- **Mode:** `mode` is one of `flight`, `train`, `bus`, `ferry`, `car`, `bike`,
  `walk` or `other`.
- **Ends:** `departure_area_id` (or `departure_location`) and the same for the
  arrival.
- **Day:** `departs_on`. It is derived from `departs_at` when you give that.
- **Schedule:** `departs_at` and `arrives_at` together, or neither. Give each end's
  `departure_timezone` or `arrival_timezone` as an IANA name such as
  `Asia/Taipei`; a time without an offset is then local to that zone. The API
  returns the times in UTC (08:15 in Taipei is `00:15Z`).
- **Optional:** `status`, `label` (never a date), `carrier`, `service_reference`
  (up to 40 characters), `travel_class`, `booking_reference`, `notes`, and
  `document_asset_ids`, which takes the id of the uploaded confirmation.

Give a time only when the confirmation states it. "Thursday, no train yet" is
`departs_on` alone.

### What visitors can see

| Record | Shared with visitors, when the record is shared | Owner-only |
|---|---|---|
| Stay | Its area and its nights | Property name, location, booking reference, contact details, notes |
| Route | Mode, status, its two areas, label, schedule, carrier, service reference, drawn line | Booking reference, travel class, notes, documents, exact locations unless shared |
| Document | Never | Everything |

New stays and routes are `private` until you choose otherwise. Booking
references and documents are never shared. The trip summary and travel-update
text are written for visitors, so keep booking references out of them.

## Status: idea, planned or confirmed

- **`idea`:** a candidate you are still comparing with another option. It covers
  no night or journey, may overlap other stays, and cannot be shared until it is
  `planned`.
- **`planned`:** the intended stay or route, when the confirmation is a request
  or the booking is not stated as confirmed.
- **`confirmed`:** the confirmation says the booking is reserved or confirmed.
  `booked` is read as `confirmed`.
- **`cancelled`:** the booking was cancelled.

The assistant uses `confirmed` only when the document says the booking is
confirmed, `planned` when it is a request or unclear, and `idea` only when you
are comparing it with another option. It says which one it chose and asks when
it is unsure.

## Rules for the assistant

1. **Show before writing.** Summarise the proposed stay or route, with dates,
   times, time zones, status and the document it will link, and create nothing
   until you say yes.
2. **Stay private.** New records are private. The assistant never sets
   visibility, and asks before anything that shares a record, publishes, changes
   the public scope, or changes a share link or collection.
3. **Keep booking details owner-only.** Put the reference, contact details,
   notes and class in their own fields, never in shared text.
4. **Keep the original.** Upload the confirmation as a `booking` document before
   creating records, so a route can link it. A stay cannot link a document yet
   ([#257](https://github.com/tjorim/travel/issues/257)); its confirmation sits in
   the trip's documents.

## Worked example

This confirmation is synthetic: the hotel, flight and reference are invented.

```text
Synthetic booking confirmation (example only)
Hotel Sample Riverside, 1 Example Road, Kaohsiung
Confirmation reference: ABC123
Check-in: Friday 4 December 2026, from 15:00
Check-out: Sunday 6 December 2026, by 11:00
Room: Double, 2 guests
Front desk: +00 00 000 0000

Flight SMP901 (Sample Air), Economy
Taipei 08:15 to Kaohsiung 09:20, Friday 4 December 2026, local times
Booking reference: ABC123
```

**Prompt to the assistant** (with the text attached or pasted):

> This is my confirmation for Hotel Sample Riverside and flight SMP901. Add both
> to my trip. Show me what you will create before you write anything, keep the
> confirmation as a trip document, and leave everything private.

**Calls the assistant makes**

1. `list_trips`, to find the trip id.
2. `call_tool` with `list_areas` and `{"trip_id": "<trip_id>", "query": "Kaohsiung"}`,
   then the same for Taipei. The results give the two area ids.
3. After you read the summary, `call_tool` with `upload_document`:

   ```json
   {"name": "upload_document", "arguments": {
     "trip_id": "<trip_id>",
     "title": "Sample Riverside and SMP901 confirmation",
     "document_kind": "booking",
     "file": {"filename": "hotel-sample-confirmation.txt",
              "content_type": "text/plain",
              "data_base64": "<base64 of the confirmation text>"}}}
   ```

   It returns the document `id` (here `f5fdd886…`) and a `file_url` for the owner.
4. Once you say yes, `call_tool` with `batch_create`:

   ```json
   {"name": "batch_create", "arguments": {"trip_id": "<trip_id>", "payload": {
     "stays": [{
       "location": {"label": "Hotel Sample Riverside",
                    "display_name": "Hotel Sample Riverside, 1 Example Road, Kaohsiung",
                    "address_line1": "1 Example Road", "locality": "Kaohsiung",
                    "country_code": "TW", "area_id": "<kaohsiung_area_id>"},
       "check_in_date": "2026-12-04", "check_out_date": "2026-12-06",
       "check_in_time": "15:00", "check_out_time": "11:00",
       "status": "confirmed", "property_name": "Hotel Sample Riverside",
       "booking_reference": "ABC123",
       "contact_details": "Front desk: +00 00 000 0000",
       "notes": "Synthetic example: double room, 2 guests."}],
     "routes": [{
       "mode": "flight", "status": "confirmed", "label": "SMP901 Taipei to Kaohsiung",
       "departure_area_id": "<taipei_area_id>", "arrival_area_id": "<kaohsiung_area_id>",
       "departs_at": "2026-12-04T08:15:00", "arrives_at": "2026-12-04T09:20:00",
       "departure_timezone": "Asia/Taipei", "arrival_timezone": "Asia/Taipei",
       "carrier": "Sample Air", "service_reference": "SMP901", "travel_class": "Economy",
       "booking_reference": "ABC123",
       "document_asset_ids": ["<document_id>"]}]}}}
   ```

5. `call_tool` with `get_stay` and `get_route` to read the records back.

**What came back when this ran** (abbreviated)

- The stay: `status` `confirmed`, `visibility` `private`, area Kaohsiung, with a
  new location, nights 2026-12-04 to 2026-12-06.
- The route: `status` `confirmed`, `visibility` `private`, `departs_on`
  `2026-12-04`, `departs_at` `2026-12-04T00:15:00Z` (08:15 in Taipei), and
  `document_asset_ids` holding the document id.

**What you check in the app**

- **Plan > Stays:** Hotel Sample Riverside, 4 to 6 December, check-in 15:00,
  check-out 11:00, confirmed, private.
- **Plan > Routes:** SMP901 from Taipei to Kaohsiung on 4 December, 08:15 to
  09:20 local time, confirmed, private. Open it to check the linked confirmation.
- **Prepare > Documents:** "Sample Riverside and SMP901 confirmation", a booking
  document that only you can open.

Check the dates, times and status against the original. The assistant can be
wrong about any of them.

**If the assistant leaves out where the stay is,** the batch is refused with
`say_where_this_stay_is_an_area_or_a_location` and nothing in it is kept.

## How this was checked

On 2026-11-07, against a copy of the development database, through the local
stdio server, these calls ran as written and returned what is shown above:
`search_tools`, `list_areas`, `upload_document`, `batch_create` (a stay and a
flight linked to the uploaded document), `get_stay`, `get_route`,
`list_documents`. Also checked: an incomplete stay was refused and the batch
kept nothing; a stay given only an `area_id` was created with a location from
that area; an `idea` stay refused `set_visibility` even with `confirm=true`;
`set_visibility` without `confirm=true` was refused; and the public preview of
the copy listed all 13 routes visible to everyone, none of which showed the
booking reference they carry (4 routes carry one).

Not checked: attached files other than the text confirmation (PDFs and
screenshots are uploaded with their own content type), the app screens named
above (the navigation labels come from the code), and production routing.

## See also

- [Owner MCP server](../backend/README.md#owner-mcp-server): setup and the full tool list.
- [Layered MCP tool discovery](decisions/196-layered-mcp-tool-discovery.md): why tools are found by search.
- [MCP resource audience](decisions/336-mcp-resource-audience.md): how a client connects in production.
- [Domain model](domain-model.md): what a stay, route and document are, and what is shared.
