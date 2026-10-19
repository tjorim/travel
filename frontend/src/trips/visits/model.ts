import { m } from "../../paraglide/messages.js";
import {
  addDays,
  locationName,
  stayCoversNight,
  type Stay,
  type Trip,
  type Visit,
  type VisitKind,
  type VisitStatus,
} from "../../tracker-model";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, clock, visitWhen } from "../labels";
import { emptyPlace, placeOfVisit, type PlaceValue } from "../PlacePicker";
import type { FormContext } from "../../forms/form-context";

type TripDates = Pick<Trip, "starts_on" | "ends_on">;

/** Every trip night a visit spans: none before departure, none on the final day. */
function visitNights(visit: Pick<Visit, "starts_on" | "ends_on">, trip: TripDates): string[] {
  if (!visit.starts_on) return [];
  const nights: string[] = [];
  for (
    let night = visit.starts_on;
    night <= (visit.ends_on ?? visit.starts_on) && nights.length < 60;
    night = addDays(night, 1)
  ) {
    if ((!trip.starts_on || night >= trip.starts_on) && (!trip.ends_on || night < trip.ends_on))
      nights.push(night);
  }
  return nights;
}

/** Which stays the owner sleeps at during a visit, and how many nights lack one. */
export function overnights(
  visit: Pick<Visit, "starts_on" | "ends_on">,
  stays: Stay[],
  trip: TripDates,
): { stays: Stay[]; uncovered: number } {
  const nights = visitNights(visit, trip);
  const covering = stays.filter((stay) => nights.some((night) => stayCoversNight(stay, night)));
  return {
    stays: covering,
    uncovered: nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length,
  };
}

/** Where a visit is: its location when it has one, else its area. */
export const visitPlace = (visit: Pick<Visit, "area" | "location">): string =>
  visit.location ? `${locationName(visit.location)} · ${visit.area.label}` : visit.area.label;

export type Values = {
  place: PlaceValue;
  title: string;
  kind: VisitKind | "";
  status: VisitStatus;
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
  notes: string;
  summary: string;
  shareTime: boolean;
  shareDatePrecision: Visit["share_date_precision"];
};

export const blank = (): Values => ({
  place: emptyPlace(),
  title: "",
  kind: "",
  status: "planned",
  startsOn: "",
  endsOn: "",
  startTime: "",
  endTime: "",
  notes: "",
  summary: "",
  shareTime: false,
  shareDatePrecision: "month",
});
export const fromVisit = (visit: Visit): Values => ({
  place: placeOfVisit(visit),
  title: visit.title ?? "",
  kind: visit.kind ?? "",
  status: visit.status,
  startsOn: visit.starts_on ?? "",
  endsOn: visit.ends_on ?? "",
  startTime: clock(visit.start_time),
  endTime: clock(visit.end_time),
  notes: visit.notes ?? "",
  summary: visit.summary ?? "",
  shareTime: visit.share_time,
  shareDatePrecision: visit.share_date_precision,
});
export const serverFields = {
  title: "title",
  kind: "kind",
  status: "status",
  starts_on: "startsOn",
  ends_on: "endsOn",
  start_time: "startTime",
  end_time: "endTime",
  notes: "notes",
  summary: "summary",
  share_time: "shareTime",
  share_date_precision: "shareDatePrecision",
};

export const lastDay = ({ value, fieldApi }: { value: string } & FormContext) => {
  if (!value) return undefined;
  const first = String(fieldApi.form.getFieldValue("startsOn" as never) ?? "");
  return !first || value < first ? m.owner_the_last_day_must_follow_the_first_day : undefined;
};

/** "Gepland" is the default, so any other status is called out. */
export const dayLine = (visit: Visit) => {
  const tags = [
    visit.status !== "planned" ? VISIT_STATUS_LABELS[visit.status] : "",
    visit.kind ? VISIT_KIND_LABELS[visit.kind] : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `${visitWhen(visit)}${tags ? ` · ${tags}` : ""}`;
};
