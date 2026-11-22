import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ROUTE_MODE_LABELS } from "@/lib/records";
import { m } from "@/paraglide/messages.js";
import type { MapLine, MapPoint, TripMapProps } from "./tripMapTypes";

export function Heading({
  level,
  ...props
}: { level: number } & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
  return <Tag {...props} />;
}

function viewLabel(view: string, on: boolean) {
  return on ? m.map_view_on({ view }) : view;
}

export function TripMapControls({
  points,
  lines,
  collapseLists,
  headingLevel,
  perspective,
  onUseDerived,
  error,
  ready,
  terrain,
  satellite,
  globe,
  selected,
  selectedKind,
  selectedPoint,
  selectedLine,
  resetFocus,
  toggleTerrain,
  toggleSatellite,
  toggleGlobe,
  selectPoint,
  selectLine,
}: Pick<TripMapProps, "points" | "lines" | "collapseLists" | "perspective" | "onUseDerived"> & {
  headingLevel: number;
  error: string;
  ready: boolean;
  terrain: boolean;
  satellite: boolean;
  globe: boolean;
  selected: string | null;
  selectedKind: "point" | "line" | null;
  selectedPoint?: MapPoint;
  selectedLine?: MapLine;
  resetFocus: () => void;
  toggleTerrain: () => void;
  toggleSatellite: () => void;
  toggleGlobe: () => void;
  selectPoint: (point: MapPoint) => void;
  selectLine: (line: MapLine) => void;
}) {
  const links = selectedPoint?.links ?? selectedLine?.links ?? [];
  return (
    <>
      {error && (
        <p role="status" className="help">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button className="secondary compact" type="button" onClick={resetFocus}>
          {m.map_show_whole_trip()}
        </Button>
        <ToggleGroup
          multiple
          aria-label={m.map_view()}
          value={[terrain && "terrain", satellite && "satellite", globe && "globe"].filter(
            (name) => typeof name === "string",
          )}
        >
          <ToggleGroupItem value="terrain" disabled={!ready} onClick={toggleTerrain}>
            {viewLabel(perspective?.label ?? m.map_3d_terrain(), terrain)}
          </ToggleGroupItem>
          <ToggleGroupItem value="satellite" disabled={!ready} onClick={toggleSatellite}>
            {viewLabel(m.map_satellite(), satellite)}
          </ToggleGroupItem>
          <ToggleGroupItem value="globe" disabled={!ready} onClick={toggleGlobe}>
            {viewLabel(m.map_globe(), globe)}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {satellite && <p className="help">{m.map_buildings_zoom_hint()}</p>}
      <p className="m-0 text-sm">{m.map_provider_privacy_notice()}</p>
      {(selectedPoint || selectedLine) && (
        <div
          className="rounded-travel-media border border-travel-border bg-travel-map-detail px-4 py-3.5 [&_a]:font-bold [&_a]:text-travel-forest [&_p]:mt-1.25 [&_p]:mb-0 [&_ul]:mt-2.5 [&_ul]:mb-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-wrap [&_ul]:gap-x-4 [&_ul]:gap-y-2 [&_ul]:p-0"
          aria-live="polite"
        >
          <strong>{selectedPoint?.label ?? selectedLine?.label}</strong>
          {(selectedLine?.from || selectedLine?.to) && (
            <p>
              {selectedLine.from ?? m.map_unknown_departure()} →{" "}
              {selectedLine.to ?? m.map_unknown_arrival()}
            </p>
          )}
          {selectedLine?.transport && <p>{ROUTE_MODE_LABELS[selectedLine.transport]}</p>}
          {(selectedPoint?.detail || selectedPoint?.dates || selectedLine?.dates) && (
            <p>
              {[selectedPoint?.detail, selectedPoint?.dates, selectedLine?.dates]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {links.length > 0 && (
            <ul>
              {links.map((link, index) => (
                <li key={`${link.label}-${index}`}>
                  {link.href ? (
                    <a href={link.href}>{link.label}</a>
                  ) : (
                    <Button className="secondary compact" type="button" onClick={link.onOpen}>
                      {link.label}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selectedPoint?.kind === "derived" && onUseDerived && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onUseDerived(selectedPoint)}
            >
              {m.map_use_as_point()}
            </Button>
          )}
        </div>
      )}
      {points.length > 0 && (
        <Collapsible.Root defaultOpen={!collapseLists}>
          <Heading level={headingLevel + 1}>
            <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent text-left font-bold text-travel-forest underline focus-visible:outline-3 focus-visible:outline-travel-focus">
              {m.map_points_count({ count: points.length })}
            </Collapsible.Trigger>
          </Heading>
          <Collapsible.Panel>
            <ol className="flex list-none flex-wrap gap-1.75 p-0">
              {points.map((point) => (
                <li key={point.id}>
                  <Button
                    className="secondary compact"
                    type="button"
                    aria-pressed={selectedKind === "point" && selected === point.id}
                    onClick={() => selectPoint(point)}
                  >
                    {point.label}
                  </Button>
                </li>
              ))}
            </ol>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
      {lines.length > 0 && (
        <Collapsible.Root defaultOpen={!collapseLists}>
          <Heading level={headingLevel + 1}>
            <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent text-left font-bold text-travel-forest underline focus-visible:outline-3 focus-visible:outline-travel-focus">
              {m.map_lines_count({ count: lines.length })}
            </Collapsible.Trigger>
          </Heading>
          <Collapsible.Panel>
            <ol className="mb-0 pl-5.5">
              {lines.map((line) => (
                <li key={line.id}>
                  <Button
                    className="secondary compact text-left"
                    type="button"
                    aria-pressed={selectedKind === "line" && selected === line.id}
                    onClick={() => selectLine(line)}
                  >
                    {line.from && line.to ? `${line.from} → ${line.to} · ` : ""}
                    {line.label}
                  </Button>
                </li>
              ))}
            </ol>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </>
  );
}
