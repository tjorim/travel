import { Button } from "@/ui/button";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { textNotice, useFeedback } from "../../query/feedback";
import type { Area, Location } from "../../api-types";
import type { RouteCoordinate } from "../RouteGeometryEditor";
import { resolvedAreaPoint, type Values } from "./model";
import { flightArc } from "./flight-arc";

export function FlightLineSuggestion({
  values,
  areas,
  locations,
  onChange,
}: {
  values: Values;
  areas: Area[];
  locations: Location[];
  onChange: (points: RouteCoordinate[]) => void;
}) {
  useLocale();
  const [notice, setNotice] = useFeedback("");
  function suggest() {
    const from = resolvedAreaPoint(values.departure, areas, locations)[0]?.coordinates;
    const to = resolvedAreaPoint(values.arrival, areas, locations)[0]?.coordinates;
    const points = from && to ? flightArc(from, to) : null;
    if (!points) {
      setNotice(textNotice(m.owner_flight_arc_unavailable));
      return;
    }
    onChange(points);
    setNotice(textNotice(m.owner_flight_arc_review));
  }
  return (
    <div className="grid gap-2.5">
      <p className="help">{m.owner_flight_arc_local()}</p>
      <Button type="button" className="secondary compact" onClick={suggest}>
        {m.owner_suggest_flight_line()}
      </Button>
      <p className="help" role="status">
        {notice}
      </p>
    </div>
  );
}
