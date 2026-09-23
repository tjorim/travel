# Map provider and privacy policy

The owner, public and unlisted trip maps (`src/TripMap.tsx`) render the hosted
OpenFreeMap Liberty vector style at
`https://tiles.openfreemap.org/styles/liberty` through the pinned `maplibre-gl`
dependency. `VITE_MAP_STYLE_URL` replaces the style at build time, and the
component accepts a per-map `styleUrl` override, so deployment can move to a
first-party style or tile proxy without changing the renderer.

OpenFreeMap is deliberately chosen as a client-safe hosted provider: it needs
no browser API key and its [terms of service](https://openfreemap.org/tos/)
allow embedding its public service, while making clear that the service is
provided as-is and may change or stop. Every map shows a visible OpenFreeMap,
OpenMapTiles and OpenStreetMap attribution. The source is not the OSM
Foundation's standard raster tile server.

## Map inputs by audience

- **Public and unlisted maps** are built only from the delivered projection:
  selected broad-route geometry and selected broad-place coordinates. They make
  no request of their own to the Travel API, so map bounds, stops and tile
  requests cannot be derived from owner-only geometry. A broad place shared
  without its coordinate fields appears only in the text sections.
- **The owner map** fetches owner-authenticated exact places, broad routes and
  finished GPX/JSON track source files. Tracks are parsed in browser memory; no
  coordinates are persisted and there is no track-geometry endpoint.

Tile requests disclose the viewed map region to OpenFreeMap (and its CDN). The
public and unlisted HTML documents use a `no-referrer` policy, and map requests
send no credentials to third-party providers, so neither tile nor attribution
requests can reveal an unlisted capability URL. The service worker caches only
the owner app shell, never map styles, tiles or projections.

## Failure policy

Missing WebGL, a style or library load failure replaces the canvas with an
explicit textual fallback. A later basemap-tile error is shown as a status
message while the authored geometry, stop buttons and route in words stay
available. There is no routing, geocoding or automatic coordinate request at
runtime.

## Owner-only terrain and satellite

Only the owner map offers the `3D-terrein` and `Satelliet` controls. Both start
off and contact their provider only when pressed; their attribution is shown
while the layer is active, and a provider failure leaves the route map usable.

- Terrain requests Terrarium-encoded elevation tiles from
  [Mapterhorn](https://mapterhorn.com/). On activation, Mapterhorn receives the
  viewer's IP address, tile paths (which identify the viewed region) and
  user-agent-related request data, and states that it retains those request
  fields for up to 30 days. The camera is limited to 60° pitch because
  MapLibre considers steeper angles experimental.
- Satellite drapes Esri World Imagery under the routes and stops, creating a
  separate disclosure of the viewed region to Esri. Its attribution names Esri,
  Maxar, Earthstar Geographics and the GIS User Community. The raster layer sits
  below the base style's existing building extrusions, so available 3D building
  shapes remain visible above satellite imagery when zoomed in. Their roofs and
  facades use vector styling, not satellite photo textures.

## Transfer trade-off

MapLibre is loaded lazily as its own chunk, so pages without map data do not
download it. On 23 September 2026, that chunk built to about 1,058 KB
(284 KB gzipped) before the style and tiles. Recheck this whenever the pinned
MapLibre version or provider changes.
