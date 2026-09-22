# Trip photo and media assets

This document describes the retained Git-backed `dist/` archive for later
migration under #40. Do not add new trip photos or derivatives to Git. The React
owner app requests metadata-stripped derivatives through the Travel API, which
stores them in application-controlled storage and requires owner review before
sharing. The archive goes offline at the v2 cutover.

Public images are selected editorial assets, not a camera-roll mirror. Keep
originals out of `dist/`; only deliberately prepared web derivatives may be
served from the public route.

```text
media/<trip-slug>/
└── original/                         Git LFS camera originals; never deployed
dist/<trip-slug>/public/
└── media/
    ├── manifest.json                 public metadata and derivative source sets
    └── <photo-id>-480.webp           public, metadata-free derivatives
        <photo-id>-960.webp
        <photo-id>-1600.webp
```

Use lowercase kebab-case identifiers, for example `alishan-sunrise-001`. An
original and every derivative share this identifier. Camera originals belong
under `media/<trip-slug>/original/`; `.gitattributes` sends that directory to
Git LFS. Do not put originals under `dist/`, even when a static-server rule
would hide them.

## Public metadata

Create `dist/<trip-slug>/public/media/manifest.json`. Every selected photo
requires an `id`, meaningful `alt`, one or more width-labelled `sources`, and
a `focalPoint` expressed in percentages. `caption` is optional. Set `moment`
to a stable `moments.items[].id` to show the image beneath that public timeline
moment; leave it out for a gallery-only image.

```json
{
  "schemaVersion": 1,
  "gallery": { "title": "Taiwan in beelden", "lead": "Een kleine openbare selectie." },
  "photos": [
    {
      "id": "alishan-sunrise-001",
      "alt": "Cederbomen in mistig ochtendlicht op een brede berghelling",
      "caption": "De ochtend boven de wolken.",
      "moment": "alishan-ochtend",
      "focalPoint": { "x": 48, "y": 40 },
      "sources": [
        { "src": "/exampleland-2054/public/media/alishan-sunrise-001-480.webp", "width": 480 },
        { "src": "/exampleland-2054/public/media/alishan-sunrise-001-960.webp", "width": 960 },
        { "src": "/exampleland-2054/public/media/alishan-sunrise-001-1600.webp", "width": 1600 }
      ]
    }
  ]
}
```

Alt text describes the visible image for someone who cannot see it; captions
add story context rather than repeating the alt text. Focal points are for
cropping (`x: 0` is left, `y: 0` is top). Do not add precise addresses, live
locations, travel-party details, booking information, or identifying
information that was not approved for the public story.

## Archive rendering

The former photo preparation helper has been retired. The archive components
render only the derivative sources already listed in their manifests. A gallery
uses:

```html
<link rel="stylesheet" href="/assets/travel/trip-media.css">
<travel-photo-gallery src="/my-trip/public/media/manifest.json"></travel-photo-gallery>
<script type="module" src="/assets/travel/trip-media.js"></script>
```

For timeline media, add `media-src` to the `travel-timeline-media` component.
It matches each photo's `moment` against the timeline item's stable `id`:

```html
<travel-timeline-media src="/my-trip/public/trip.json" media-src="/my-trip/public/media/manifest.json"></travel-timeline-media>
<script type="module" src="/assets/travel/trip-moments.js"></script>
```
