# Trip photo and media assets

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

## Prepare and publish an image

Track a camera original once with `git lfs track "media/<trip-slug>/original/*"`
(the repository rule already covers it), add the original, then create public
derivatives from the repository root:

```bash
scripts/prepare-public-photo.sh media/exampleland-2054/original/alishan-sunrise-001.jpg dist/exampleland-2054/public/media/alishan-sunrise-001
```

The script auto-orients, strips all EXIF/XMP/IPTC metadata (including GPS),
and creates 480, 960 and 1600px WebP files. Add every derivative to the
manifest before committing; the components deliberately render only sources
listed there. Review the image and its crop before committing; inspect every
derivative with
`exiftool -G1 -a -s dist/<trip-slug>/public/media/<photo-id>-*.webp` and
confirm there are no GPS, location, camera-owner, or serial-number fields.

Render a gallery with:

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
