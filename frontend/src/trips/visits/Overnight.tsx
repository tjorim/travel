import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { stayLabel, type Stay, type Trip, type Visit } from "../../tracker-model";
import { overnights } from "./model";

/** Where the nights of a visit are spent; nothing when it covers no night. */
export function Overnight({
  visit,
  stays,
  trip,
}: {
  visit: Visit;
  stays: Stay[];
  trip: Pick<Trip, "starts_on" | "ends_on">;
}) {
  useLocale();
  const sleep = overnights(visit, stays, trip);
  if (!sleep.stays.length && !sleep.uncovered) return null;
  return (
    <div className="grid gap-0.75">
      <span className="text-sm font-medium text-travel-muted">
        {m.owner_overnight_stay()} {sleep.stays.map(stayLabel).join(", ") || "—"}
        {sleep.uncovered > 0 ? m.owner_uncovered_nights({ count: sleep.uncovered }) : ""}
      </span>
    </div>
  );
}
