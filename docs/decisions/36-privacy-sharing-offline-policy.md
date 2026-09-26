# Travel privacy, sharing, and offline policy

Issue [#36](https://github.com/tjorim/travel/issues/36) defines the v1 privacy
contract for the Travel application. It is the authority for application API,
PWA, storage, map, static-export, and MCP work. Issue [#37](https://github.com/tjorim/travel/issues/37)
defines the data model that implements it; it must not weaken this policy.

## Status and terms

This policy applies to Travel application data. The Git-backed archive is no
longer deployed; its Taiwan trip enters the application only through the
owner-run #40 import, arrives private, and is never used to infer
publication. Complete the [publication safety check](../publication-safety-check.md)
before publishing or activating a share link.

There is one account owner. The authenticated OpenID Connect `sub` is the only
identity authorized to read or change canonical data. There are no viewer
accounts, groups, invitations, recipient identities, or collaborative editing.
Travel is access-controlled, not end-to-end encrypted.

The service evaluates every request as one of these audiences:

| Audience | Credential | Permitted data |
|---|---|---|
| Owner | A valid owner session whose subject owns the trip/resource. | The canonical record and its private files, metadata, exact geometry and navigation. |
| Public | None. | Only an active, deliberately published public projection. |
| Unlisted link | A valid, unexpired, non-revoked capability. | Only that link's active, deliberately selected projection and field scope. |

An unlisted link is a forwardable capability, not proof of who opened it. Its
holder can forward it or save what it sees. The product calls it a **named
share link** when the owner gives it an owner-only label such as "Family" or
"Hotel". That label helps the owner distinguish links and audit their scope;
it neither authenticates a recipient nor travels in the shared response.
Public is not a broader unlisted mode: it is an explicit decision to make a
projection available to anyone and potentially indexable.

A named share link is not a personal access token. It is read-only and limited
to its published projection; it cannot authenticate an owner, call owner API
or MCP operations, create another link, or grant access beyond its declared
scope. Person-bound sharing would require recipient identity or verification,
which is out of scope for v1.

`Owner`, `public`, and `unlisted` are audience labels, not fields that a
browser may use to filter a private response. A shared representation is a
separate projection, not a masked copy of a canonical resource.

Fine-grained named share links exist only for the unlisted audience. A trip
with a private baseline and no active link remains owner-only. A public
projection is still carefully owner-curated and redacted, but it is a single
deliberate publication available identically to every anonymous visitor; it
has no per-link label, recipient-specific detail level, or capability check.

## Public page and named share links

Canonical trip data has no visibility or publication fields. It is always
owner-only; sharing is possible only through a separate delivery record. This
keeps the model honest: there is no trip-level setting that suggests all of a
trip has become visible.

The owner can create one optional public surface for everyone and zero or more
optional named share links for people with a capability URL. Each has its own
list of records; what a record shows is a fixed allowlist per kind. A public surface is
reachable only while its `state` is `published`; a link is reachable only while
its own `state` is `active`, unexpired and unrevoked. No trip is public by
default, and neither kind ever becomes a view of all canonical trip data.

A named share link remains forwardable and does not authenticate its holder.
Its owner-only label and scope make it useful for distinct audiences
without turning it into a recipient account or owner API token. It may reveal
more or different owner-approved detail than the public projection, but never a
field prohibited by this policy.

Publishing or withdrawing the public surface never changes canonical content,
silently selects new items, or affects named links. Links are revoked or rotated
individually. Saving a changed scope is a live update for the relevant active
surface or link, so the owner must preview and review it carefully.

## Default resource policy

All canonical resources start owner-only. `Not included` below means that a
new resource is absent from that audience until the owner expressly adds a
safe projection. A public projection is an owner-reviewed set of records,
each shown through a fixed allowlist of fields, for every public follower. The owner sees a
public-view preview before activating it. An unlisted scope is an independent,
link-specific allowlist; neither kind grants access to an entire trip merely
because one trip item was selected.

**Amended 2026-09-25 (visibility).** Every shareable record carries its own
`visibility`: `private` (the default, reaches nobody), `everyone` (reaches the
public view and every hidden link) or `custom` (reaches only the audiences whose
scope lists it). A scope lists records, never fields; what a record shows is
fixed per kind and can never include a field prohibited by this policy. Only
records that are themselves share-safe carry a visibility: a private original
never gets one, and a record that cannot yet be shared safely (a location without a
public name, an unapproved copy) is rejected with a
reason. Leaving `custom`, or deleting a record, removes it from every scope.
The earlier requirement of a separately authored twin now applies only where the
shared thing is a different artifact: photos and videos (application-generated, reviewed derivatives). An area, a location, a route and a stay are shared as themselves through a
fixed allowlist, and the reisupdate is the one story record.

The owner can create multiple named share links for the same trip, each with a
different scope. For example, one link may list selected custom photos and
updates, while another lists nothing beyond what is set to everyone. The owner must not reuse the same capability merely because two links
happen to have similar audiences.

| Resource | Owner default | Public default | Unlisted default | Allowed shared representation |
|---|---|---|---|---|
| Trip and visits | Full canonical trip. | Not included. | Not included. | Selected title, summary, dates at the chosen precision, and visits (the area, the days at the chosen precision, the text for visitors; the time only when the owner chose to show it). Notes never. |
| Areas, locations and maps | Exact location, address, coordinates, viewport and provider identifiers. | Not included. | Not included. | A shared area shows its label, region, country and generalized point. A shared location shows only its owner-chosen public name, city, country and point; never its address, notes, provider identifiers or display name. |
| Reisupdates | Private notes, timestamp, location and attached originals. | Not included. | Not included. | Title, text, date at the chosen precision and the area. Its own visibility decides who receives it. |
| Stays | Exact property, address, dates, booking and contact data. | Not included. | Not included. | Only the city or area and the nights at the chosen date precision. The property, location, check-in details, contacts and booking data are never shared. |
| Routes | Exact locations at either end, schedule, carrier/service reference, booking reference, travel class, notes, linked documents and the drawn line. | Not included. | Not included. | Mode, status, the two areas, the drawn line, the schedule and time zones, carrier and service reference. A location appears on the map only when that location is itself shared, which suits public infrastructure such as airports and stations. Booking reference, class, notes and documents never. Without a drawn line, a straight line joins the two area points, or the two shared locations. |
| Documents | Owner-wide library or trip-specific file, preview, filename and metadata. | Never included. | Never included. | Never shared, including links and metadata. |
| Media | Original file, import provenance, EXIF/XMP/IPTC, face/person tags and exact capture data. | Not included. | Not included. | An explicitly selected derivative with all metadata stripped and owner-approved visible content, caption and alt text. |
| Routes | An approximate line the owner drew, with its travel mode. The application takes no raw location data: it has no track upload, timestamps, points, speed or elevation. | Not included. | Not included. | The line, its mode and its date at the chosen precision, when the owner shares it. |
| Private journal | The private notes of a reisupdate and all its metadata. | Never included. | Never included. | Never. The shared text of a reisupdate is a separate field written for visitors. |
| Navigation and external-map links | Exact destination, route, provider URL and map viewport. | Not included. | Not included. | A shared place offers directions: to a shared location's point, or a city/region link for an area. Never an address. |

An owner can revise or remove a projection without changing the canonical
record. Sharing an item never changes its default or makes later items shared.
No projection may contain an owner subject, internal database ID, booking or
confirmation code, precise address, travel-party contact detail, emergency
information, raw document/media metadata, exact location, or live/near-real-
time position. A flight or other service reference is permitted only in the
selected route summary described above; it is not a booking credential.

## Server authorization and projection contract

Authorization happens before a database query, object-store lookup, map-tile
request that includes a location, derivative generation, signed-file URL, or
navigation-link generation. The server determines the audience, loads only the
corresponding projection, and serializes a dedicated response schema. Clients,
including the owner PWA and MCP tools, must never receive a restricted field
only to hide it in their UI.

In particular, a public or unlisted response must not include restricted
coordinates, geometry, address parts, internal or provider IDs, map viewport,
navigation URL, object-store key, file URL, EXIF/XMP/IPTC, import source,
original filename, deleted-resource data, owner identifier, or a reference
from which one can fetch any of those values. Omitted resources are absent,
not returned with a `hidden` flag. List totals, pagination, error messages and
stable identifiers must not reveal out-of-scope resources.

Every endpoint serving a resource or derivative repeats this decision. A page
projection does not authorize a guessed media, map, document or download URL.
File access is through an audience-checked handler or an audience-scoped,
short-lived URL issued after that check. Public output may be a generated static
export; unlisted output must remain behind a capability-checking delivery layer
so that revocation is enforceable. Neither audience may rely on an obscured
static pathname or browser-side redaction.

Map rendering receives only the audience projection. It must not calculate a
viewport, geocoding request, navigation target, tile request parameter or
fallback link from owner geometry. An area is stored/rendered as its own
approved representation rather than a rounded canonical coordinate.

Both owner and visitor maps may offer optional terrain and satellite layers.
Those layer requests use only the same audience-scoped viewport and geometry
already used for the base map; enabling them cannot obtain or infer owner-only
location data.

An audience map draws each selected route as its owner-drawn line. A route
without one gets a straight, clearly generalized line between its two area
points, or between its two locations when those are themselves shared. It
never draws a line from a location's exact coordinates that is not shared, and
it never guesses which record a line belongs to.

## Public and custom-link publication

Turning a public page or named link on is a deliberate owner action; editing
what it shows, once on, is not:

1. The owner selects allowed items and fields into the trip's public scope or
   a named link's scope, and may preview the rendered audience view at any
   time as a non-gating, owner-authenticated check.
2. The service validates every scope change against this policy before
   accepting it and records the relevant audit event.
3. `publish` (public) or `activate` (a named link) is the one deliberate
   action that turns access on. From then on, editing scope or canonical
   content takes effect immediately for anyone with access — there is no
   separate frozen projection version to review and re-publish. `unpublish`,
   `revoke`, and `rotate` are the actions that turn access off or replace a
   token.

A public projection is the trip's default follower view: it has no access
credential and is intentionally discoverable unless its delivery settings say
otherwise. It must have the normal public route safety review, including visual
review of media. Unlisted projections are not sent to search engines or
analytics and send `X-Robots-Tag: noindex,
noarchive` plus `Referrer-Policy: no-referrer`. These headers reduce accidental
disclosure but do not make a capability secret once a recipient has received
it.

Each named share link has an owner-only label, a live allowlisted field-level
scope, an expiry, and a lifecycle state (`draft`, `active`, `revoked`, or
`expired`). While a link is `draft` or `active`, its scope is a live field:
the owner can widen or narrow the selected resources, fields or precision at
any time, and an already-`active` link reflects the change immediately for
anyone holding its token — there is no separate replacement link needed just
to change what it shows. What requires a deliberate owner action is only
whether the link is currently usable at all: `activate` mints its capability,
and `revoke` or expiry ends it. The default lifetime is 30 days and a timed
link can last at most 90 days. An owner may instead explicitly choose no
expiry, with a warning that the link remains a forwardable credential until it
is revoked or rotated. It cannot be reactivated after expiry or revocation. A
link must never be a generic
"everything in this trip" switch.

After a visitor successfully opens an unlisted link, the browser automatically
adds that capability and the delivered title/summary to its local “previously
viewed hidden trips” list. This is a convenience feature, not a server-side
recipient record: it stays on that browser/device, is never sent to an index
endpoint, and can be removed there. Since the raw capability remains a bearer
credential in local browser storage, the homepage explicitly warns that anyone
using that browser profile can reopen a saved trip. A `404` for a revoked or
expired saved link removes it from the list.

The service generates at least 256 bits of entropy with a cryptographically
secure random generator and encodes the capability in a URL-safe form. It
stores a keyed verifier/digest rather than a recoverable token whenever the
delivery design permits. Tokens are treated like credentials: redacted from
application, proxy and error logs; omitted from analytics; never placed in
page markup or external URLs; and stripped from the visible URL after the
capability exchange where the delivery protocol allows. Link pages must not
load third-party content that could receive a referring URL.

Revoking a link immediately rejects new capability exchanges, invalidates the
link's server sessions and signed-file URLs, and purges all application-
controlled responses and derivatives for that link. Rotation revokes the old
capability and activates a replacement with the same current scope and a
fresh token; both remain grouped as one owner-visible link history. It exists
for replacing a suspected-leaked token, not for changing scope, which the
owner can already edit live on an active link without rotating. Revocation
cannot withdraw a file, screenshot, screen
recording, copied text, or browser cache already possessed by a recipient.
The UI must say this plainly before activation and revocation.

The audit log records link/projection IDs (not raw tokens), the scope in
effect at the time of the action, owner action, creation/activation/revocation/
rotation/expiry timestamps, and an optional owner-entered reason. The owner-only link label and active URL are available in the
owner-authenticated link-management view but are not copied into recipient-facing responses or
access logs. The service deliberately does not create recipient profiles or
retain recipient IP addresses as a sharing feature. Audit events are owner-only
and retained for 24 months, then deleted unless a shorter legal or security
requirement applies.

## Offline copies and cache behavior

Offline is an owner-only, device-scoped feature. A signed-in owner explicitly
chooses each canonical resource, projection or derivative to pin; the app does
not prefetch trips, documents, media or maps simply because they were viewed.
Private resources are not served through a shared service-worker cache, and
unlisted links have no pin-for-offline feature in v1. Ordinary browser caches
for public/unlisted responses must not be relied on for offline access.

An offline copy is bound to the owner account and the browser/device profile
that created it. It must be encrypted at rest with a device-keystore-backed or
equivalent non-exportable key where the platform offers one, and the product
must clearly disclose when the browser/platform cannot provide that guarantee.
No durable access token is stored with the copy. The owner can inspect and
remove individual copies or clear all copies on the current device; sign-out
removes the local key and all associated offline data. A request to wipe a
registered device is completed when that device next reconnects, not while it
is genuinely offline.

Each pinned copy has a short access lease and policy version. On the next
connection, and no later than the lease expiry, the app revalidates owner
access and current sharing state; it removes a copy that was deleted, unshared,
redacted, or no longer owned. A remote revocation or publication change cannot
reach a genuinely offline device, so that copy can remain readable only until
its lease expires or it reconnects. The app must show its last validation time
and expiry rather than claiming immediate remote erasure. Link revocation never
grants a recipient an offline copy, but it likewise cannot erase ordinary
browser downloads or caches already held outside the app's control.

Owner-only API responses use `Cache-Control: no-store` unless they are being
handled by the explicit encrypted offline-copy flow. Capability exchanges,
unlisted responses and signed-file responses use `Cache-Control: no-store,
private` and must be purged/rejected on revocation. The live public projection uses `Cache-Control: no-store` so changes to
publication or scope are checked on the next request. No static trip export is
used for public or unlisted browser delivery.

## Retention, deletion, and service security

Canonical content, private files, generated derivatives, publication
projections and their access policy live in application-controlled database and
object storage on the backed-up VPS. Git contains application code,
documentation, schemas and infrastructure only; it is not a source of truth or
backup for new user content.

The service retains active data until the owner deletes it. Deletion immediately
removes it from live owner, public and unlisted responses; it then queues all
derived files, search records and application caches for purge. Recoverable
deletion may retain a sealed copy for at most 30 days. Backup copies expire
within 90 days and are not restored into production except through an audited
restore procedure. A restore must reapply current deletion, publication and
revocation state before making data available.

VPS database volumes, object storage and backups are encrypted at rest, with
secrets managed separately from content and backups. All browser, API, MCP and
object-delivery traffic uses modern TLS; secure cookies and signed URLs are
short-lived and sent only over HTTPS. Access to production storage and backups
is limited to the service and authorized operators, with restore testing and
access review recorded by the infrastructure operation. This is operational
encryption and access control, not a promise that the service operator cannot
access plaintext.

## Implementation checks

Issues implementing this policy must test at least these boundaries:

- Owner, anonymous public, valid unlisted, expired, revoked and rotated-link
  requests receive the correct response or denial.
- A public or unlisted payload cannot reveal restricted fields through nested
  objects, IDs, map/viewports, metadata, signed URLs, errors, counts or cache.
- A link containing one selected hotel/city item cannot read any other stay,
  location, factory location, document, media original or navigation link.
- Revocation invalidates application sessions, signed URLs and application
  cache entries, while the UI honestly describes downloaded-copy limits.
- Offline copies are opt-in, device/account scoped, encrypted where supported,
  lease-checked and removed after current-access validation fails.

The pre-launch MVP `published` endpoint has been removed. Its full-trip
serialization does not meet this policy; browser delivery uses only the
audience projection and link model above.
