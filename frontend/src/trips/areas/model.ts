import { m } from "../../paraglide/messages.js";
import type { Area } from "../../tracker-model";
import type { FormContext } from "../../forms/form-context";

export type Values = {
  label: string;
  countryCode: string;
  region: string;
  latitude: string;
  longitude: string;
  timezone: string;
};
export const blank = (): Values => ({
  label: "",
  countryCode: "",
  region: "",
  latitude: "",
  longitude: "",
  timezone: "",
});
export const fromArea = (area: Area): Values => ({
  label: area.label ?? "",
  countryCode: area.country_code ?? "",
  region: area.region ?? "",
  latitude: area.latitude?.toString() ?? "",
  longitude: area.longitude?.toString() ?? "",
  timezone: area.timezone ?? "",
});
export const serverFields = {
  label: "label",
  country_code: "countryCode",
  region: "region",
  latitude: "latitude",
  longitude: "longitude",
  timezone: "timezone",
};

export const bothCoordinates = ({ value, fieldApi }: { value: string } & FormContext) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "")
    ? m.owner_enter_both_map_coordinates_or_leave_both_empty
    : undefined;
const withinRange =
  (min: number, max: number, name: () => string) =>
  ({ value }: { value: string }) =>
    value !== "" && !(Number(value) >= min && Number(value) <= max)
      ? () => m.owner_must_be_between_and_degrees({ p0: name(), p1: min, p2: max })
      : undefined;
export const latitudeRange = withinRange(-90, 90, m.owner_latitude);
export const longitudeRange = withinRange(-180, 180, m.owner_longitude);
export const knownTimeZone = ({ value }: { value: string }) => {
  if (!value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() });
    return undefined;
  } catch {
    return m.owner_unknown_time_zone_choose_one_from_the_suggestions;
  }
};
export const areaCoordinate = (value: number) => (Math.round(value * 100) / 100).toString();
export const areaSummary = (area: Area) =>
  [area.region, area.country_code, area.timezone].filter(Boolean).join(" · ") ||
  m.owner_only_for_this_trip();
