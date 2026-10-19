import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";

/** The saved map point with a link to it; nothing when the location has no point. */
export function MapTarget({
  latitude,
  longitude,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}) {
  useLocale();
  if (latitude == null || longitude == null) return null;
  return (
    <p className="help">
      {m.owner_saved_map_point_and_navigation_target()} {latitude}, {longitude} ·{" "}
      <a
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`}
        target="_blank"
        rel="noreferrer"
      >
        {m.owner_view_on_map()}
      </a>
    </p>
  );
}
