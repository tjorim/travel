import { useLocale } from "@/i18n/locale";
import { configuredMapStyleUrl } from "@/lib/map/map-style";
import { m } from "@/paraglide/messages.js";
import { cn } from "cn";
import { Heading, TripMapControls } from "./TripMapControls";
import type { TripMapProps } from "./tripMapTypes";
import { useTripMap } from "./useTripMap";

export { areaFocusPoints, framingCoordinates } from "./tripMapFraming";
export { paintBuildings } from "./tripMapLayers";
export type { MapLine, MapLink, MapPerspective, MapPhoto, MapPoint } from "./tripMapTypes";

const attribution = (
  <>
    <a href="https://openfreemap.org" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">
      © OpenFreeMap
    </a>{" "}
    ·{" "}
    <a
      href="https://openmaptiles.org"
      target="_blank"
      rel="noreferrer"
      referrerPolicy="no-referrer"
    >
      OpenMapTiles
    </a>{" "}
    ·{" "}
    <a
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      referrerPolicy="no-referrer"
    >
      © OpenStreetMap
    </a>
  </>
);

export function TripMap({
  points,
  lines,
  owner = false,
  collapseLists = false,
  wide = false,
  bare = false,
  headingLevel = 3,
  perspective,
  styleUrl = configuredMapStyleUrl,
  focus,
  follow,
  photos,
  onUseDerived,
}: TripMapProps) {
  useLocale();
  const { canvas, hasGeometry, hovered, controls } = useTripMap({
    points,
    lines,
    owner,
    perspective,
    styleUrl,
    focus,
    follow,
    photos,
  });
  const { error, ready, terrain, satellite } = controls;

  if (!hasGeometry)
    return (
      <section className="travel-card grid min-w-0 gap-3.5">
        <Heading level={headingLevel} className="m-0">
          {m.map_title()}
        </Heading>
        <p>{m.map_no_map_coordinates_are_available_for_this_trip_yet()}</p>
      </section>
    );
  return (
    <section
      className={cn("grid min-w-0 gap-3.5", bare ? "min-[1100px]:travel-card" : "travel-card")}
      aria-label={m.map_trip_map()}
    >
      <Heading level={headingLevel} className={cn("m-0", bare && "max-[1099px]:sr-only")}>
        {m.map_title()}
      </Heading>
      <div
        className={cn(
          "relative h-map-canvas overflow-hidden rounded-xl border border-travel-border bg-travel-map-bg",
          owner && "min-[960px]:h-map-owner-canvas",
          wide && "min-[1100px]:h-map-wide-canvas",
          bare && "max-[1099px]:h-map-phone-canvas",
        )}
      >
        <div
          ref={canvas}
          className="size-full"
          // A group, not an image: the map library puts a focusable canvas and marker controls inside it.
          role="group"
          aria-label={m.map_with_points_and_routes()}
        />
        {hovered && (
          <span
            className="pointer-events-none absolute top-3 left-3 max-w-full rounded-md bg-travel-surface px-2.25 py-1.25 text-sm text-travel-ink shadow-md"
            aria-hidden="true"
          >
            {hovered}
          </span>
        )}
        {error && !ready && (
          <p className="absolute inset-0 m-0 grid place-content-center bg-travel-map-bg p-6 text-center text-travel-muted">
            {m.map_unavailable_point_buttons()}
          </p>
        )}
        <div className="absolute right-0 bottom-0 z-2 max-w-full bg-travel-surface/90 px-1.5 py-0.75 text-xs text-travel-ink [&_a]:text-inherit">
          {attribution}
          {terrain && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://mapterhorn.com/attribution"
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                © Mapterhorn
              </a>
            </>
          )}
          {satellite && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://www.esri.com/"
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                © Esri
              </a>
              , Maxar, Earthstar Geographics, and the GIS User Community
            </>
          )}
        </div>
      </div>
      <TripMapControls
        points={points}
        lines={lines}
        collapseLists={collapseLists}
        headingLevel={headingLevel}
        perspective={perspective}
        onUseDerived={onUseDerived}
        {...controls}
      />
    </section>
  );
}
