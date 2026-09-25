# Privacy-first Travel tracker MVP

> **Superseded for sharing.** The scoped public-surface and named-share-link
> model in [decision 36](36-privacy-sharing-offline-policy.md) replaced this
> MVP's trip-level visibility, publication state and published-ID design. This
> document remains as historical context for the first tracker release.

## Decision

The first tracker release has exactly one account owner for each trip. The API
uses the authenticated OpenID Connect `sub` as that stable owner identifier;
there is no local password, profile, or user table. Collaborators are deferred
until their invitations and access-revocation rules can be designed together.

Trips are private by default. An owner must explicitly choose one of these
visibility modes and publication states:

| Visibility | Published? | Meaning |
|---|---:|---|
| `private` | no | Visible only to the owner through authenticated API routes. |
| `unlisted` | yes | Available only through an opaque, unguessable published-trip ID. |
| `public` | yes | Deliberately publishable; discovery/indexing is a later client concern. |

The public API never returns owner identifiers or private-only fields. A trip
cannot be published while its visibility is `private`.

## Data and location boundary

The MVP stores a trip title, route stages, chronological moments, broad place
labels, deliberately selected photo references, and publication metadata.
Place records contain only a display label and optional ISO country code. They
do not collect GPS coordinates, accommodation addresses, live location,
booking data, documents, or emergency contacts. Maps therefore represent
selected broad route stages, not a trace of the traveller.

Photo binary upload, processing, and hosting are not part of this API. A
moment can reference an explicitly selected HTTPS photo URL; clients must not
turn this into automatic camera-roll or location collection.

## Coexistence with the archive

The current Git-backed archive remains online and authoritative for its static
public pages and protected operational documents. The tracker is a separate
application data source: it does not import JSON, documents, bookings, or
private archive data. Any migration needs a later, explicit decision and a
reviewable export/import plan.

## Initial user flow

After sign-in, an owner creates a private trip, adds broad route stages and
moments, and previews it privately. Publishing requires an explicit change to
`unlisted` or `public` plus a `published` state. Removing publication returns
the trip to `draft`; the opaque published ID is retained so a later deliberate
republication does not create misleading new links.
