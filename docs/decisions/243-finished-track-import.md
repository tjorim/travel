# Finished-file route drafts (#243)

Decision D5 permits an owner-selected finished GPX, GeoJSON LineString or
MultiLineString (also wrapped in Features), Dawarich point-array/OwnTracks-compatible JSON (latitude/longitude or lat/lon), or phone
Timeline JSON (semanticSegments/timelinePath, top-level timelinePath segments,
or locations with E7 coordinates) solely to seed an approximate route.
There is no live fetch, GPS capture, inferred place, visit, day or schedule.
Other export schemas fail safely rather than guessing from arbitrary fields.

## Transient boundary

`POST /api/trips/{trip_id}/route-line-import` checks authenticated trip ownership
and a process-local 6/minute and 30/hour IP quota before reading a binary body.
It accepts only application/octet-stream, never multipart: FastAPI UploadFile
would parse and potentially spool raw parts to disk before the endpoint runs.
The application streams at most 2 MiB into request-local memory. It uses neither
Request.body's cached bytes nor query/mutation caches, object storage, temporary
files, database writes, audit events or third-party services. The browser holds
the selected File only in the native picker/request, clears the picker after
processing, aborts on cancel/unmount, and keeps only the approximate draft.
No raw metadata is part of a URL. The endpoint responds no-store.

UTF-8 only; DTDs/entity declarations are refused before XML parsing. No external
resource resolver is used. XML nesting and JSON nesting are capped at 32;
JSON nesting is checked before decoding. The byte cap bounds tree allocation;
there are at most 20,000 input points. Nonfinite/out-of-range pairs, malformed
structures and unsupported geometry fail with fixed diagnostics. Parser
exceptions are caught and discarded, and are never chained into HTTP failures.
Application timing logs contain route templates/counts only; raw bodies, parser
exceptions, filenames and point metadata are never logged. Existing access logs
contain method/path/status, not bodies. Deployments must not enable request-body
or traceback-local capture for this endpoint. No new proxy or disk staging
configuration is required; production proxy/body capture was not exercised.
One worker is the existing rate-limit deployment contract; scale-out needs shared
counters just like the application's other process-local limits.

## Owner review and save

The owner chooses start/end percentages of points in file order before each
request, and selects the route's travel mode in the existing form. Separate
segments connect in file order, explicitly explained in both locales. Selection
never uses timestamps. Only lon/lat enter approximation: coordinates round to
**two decimals**, nearby rounded points collapse, and a uniform cap retains
endpoints at at most 500 draft vertices. A degenerate result is refused.
All other fields (including timestamps, accuracy, speed and elevation) disappear
with request memory. No raw-file download, export or persisted track exists.

The editable draft map appears beside the unchanged route editor. Applying it
changes only normal form coordinates; the regular route save is still required.
Cancel, replacement requests, errors and closing the editor cannot alter the
saved route. The existing flight suggestion remains available. An applied line
has the same ordinary LineString contract (at most 10,000 pairs) as hand drawing;
there is no provenance field, raw-point link or new visitor field. Subsequent
manual edits use the existing editor precision. Publication still requires the
owner's deliberate scope choice and review of the approximate line.

Format reference: [Dawarich export documentation](https://dawarich.app/docs/getting-started/export-your-data/) describes OwnTracks-compatible JSON. Fixtures use synthetic lat/lon locations as well as the latitude/longitude point arrays.
