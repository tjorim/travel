import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ownerLocationName, type Area, type Location } from "../../tracker-model";
import { visibilityLabel } from "../visibility";
import { areaSummary } from "./model";

/** Every area with the locations reused inside it, and buttons to open either or add a location. */
export function AreaInventory({
  areas,
  locations,
  locationsReady,
  onInspect,
  onAddLocation,
  onOpenLocation,
}: {
  areas: Area[];
  locations: Location[];
  /** The locations finished loading without an error. */
  locationsReady: boolean;
  onInspect: (areaId: string) => void;
  onAddLocation: (areaId: string) => void;
  onOpenLocation: (locationId: string) => void;
}) {
  useLocale();
  return (
    <div className="saved-records mt-0.5">
      {areas.map((area) => (
        <article
          className="grid gap-2.5 rounded-xl border border-travel-divider bg-travel-surface p-4"
          key={area.id}
        >
          <div className="capture-heading m-0 items-center max-[620px]:flex-col max-[620px]:items-stretch">
            <Button
              className="document-select"
              type="button"
              onClick={() => onInspect(area.id)}
              aria-label={m.owner_view_area({ p0: area.label })}
            >
              <strong>{area.label}</strong>
              <span>
                {areaSummary(area)} · {visibilityLabel(area.visibility)}
              </span>
            </Button>
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onAddLocation(area.id)}
            >
              {m.owner_add_location()}
            </Button>
          </div>
          {locationsReady && (
            <div className="saved-records ml-4 border-l-2 border-travel-divider pl-4 max-[620px]:ml-1 max-[620px]:pl-3">
              {locations
                .filter((place) => place.area_id === area.id)
                .map((place) => (
                  <Button
                    className="document-select"
                    key={place.id}
                    type="button"
                    onClick={() => onOpenLocation(place.id)}
                  >
                    <strong>{ownerLocationName(place)}</strong>
                    <span>
                      {[
                        place.address_line1,
                        place.locality,
                        place.country_code,
                        visibilityLabel(place.visibility),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Button>
                ))}
              {!locations.some((place) => place.area_id === area.id) && (
                <p className="help">{m.owner_no_locations_in_this_area_yet()}</p>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
