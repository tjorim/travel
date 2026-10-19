import { m } from "../../paraglide/messages.js";
import {
  addDays,
  formatDay,
  locationName,
  stayLabel,
  type LocationInput,
  type Stay,
  type Trip,
} from "../../tracker-model";
import type { FormContext } from "../../forms/form-context";

export type StayValues = {
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  status: Stay["status"];
  websiteUrl: string;
  address: string;
  locality: string;
  countryCode: string;
  location: LocationInput | null;
  bookingReference: string;
  contactDetails: string;
  notes: string;
  shareDatePrecision: Stay["share_date_precision"];
};

export const blankStay = (trip: Trip): StayValues => {
  const checkIn = trip.starts_on ?? new Date().toISOString().slice(0, 10);
  return {
    propertyName: "",
    checkInDate: checkIn,
    checkOutDate: addDays(checkIn, 1),
    checkInTime: "",
    checkOutTime: "",
    status: "planned",
    websiteUrl: "",
    address: "",
    locality: "",
    countryCode: "",
    location: null,
    bookingReference: "",
    contactDetails: "",
    notes: "",
    shareDatePrecision: "month",
  };
};
const locationInput = (place: Stay["location"]): LocationInput | null => {
  if (!place) return null;
  return { existing_location_id: place.id };
};
export const fromStay = (stay: Stay): StayValues => ({
  propertyName: stay.property_name ?? "",
  checkInDate: stay.check_in_date,
  checkOutDate: stay.check_out_date,
  checkInTime: stay.check_in_time?.slice(0, 5) ?? "",
  checkOutTime: stay.check_out_time?.slice(0, 5) ?? "",
  status: stay.status,
  websiteUrl: stay.website_url ?? "",
  address: stay.location?.address_line1 ?? "",
  locality: stay.location?.locality ?? "",
  countryCode: stay.location?.country_code ?? "",
  location: locationInput(stay.location),
  bookingReference: stay.booking_reference ?? "",
  contactDetails: stay.contact_details ?? "",
  notes: stay.notes ?? "",
  shareDatePrecision: stay.share_date_precision,
});

export const stayFields = {
  property_name: "propertyName",
  check_in_date: "checkInDate",
  check_out_date: "checkOutDate",
  check_in_time: "checkInTime",
  check_out_time: "checkOutTime",
  status: "status",
  website_url: "websiteUrl",
  booking_reference: "bookingReference",
  contact_details: "contactDetails",
  notes: "notes",
  share_date_precision: "shareDatePrecision",
};
export const PLACE_FIELDS = [
  "propertyName",
  "address",
  "locality",
  "countryCode",
  "location",
] as const;

export const checkOutAfterCheckIn = ({ value, fieldApi }: { value: string } & FormContext) =>
  value && value <= String(fieldApi.form.getFieldValue("checkInDate" as never) ?? "")
    ? m.owner_check_out_is_no_earlier_than_the_morning_after_the_first_night
    : undefined;
export const PLACE_REQUIRED =
  m.owner_choose_where_you_are_staying_search_for_a_location_or_enter_an_address_o;
export const httpsOnly = ({ value }: { value: string }) =>
  value.trim() && !value.trim().startsWith("https://") ? m.owner_use_an_https_address : undefined;

export const locationLine = (place: Stay["location"] | undefined) =>
  place ? [...new Set([locationName(place), place.locality].filter(Boolean))].join(" · ") : "";
export const overlaps = (stay: Stay, checkIn: string, checkOut: string) =>
  stay.check_in_date < checkOut && checkIn < stay.check_out_date;
/** Ideas for the same dates are shown together as alternatives; a lone idea is listed like any stay. */
export function stayEntries(stays: Stay[]): { stays: Stay[]; dates?: string }[] {
  const groups = new Map<string, Stay[]>();
  for (const stay of stays.filter((item) => item.status === "idea")) {
    const key = `${stay.check_in_date}|${stay.check_out_date}`;
    groups.set(key, [...(groups.get(key) ?? []), stay]);
  }
  const shown = new Set<string>();
  return stays.flatMap((stay) => {
    const key = `${stay.check_in_date}|${stay.check_out_date}`;
    const group = stay.status === "idea" ? groups.get(key)! : [stay];
    if (group.length < 2) return [{ stays: [stay] }];
    if (shown.has(key)) return [];
    shown.add(key);
    return [
      {
        stays: group,
        dates: `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
      },
    ];
  });
}
export const overlapLabel = (stay: Stay) =>
  `${stayLabel(stay)} (${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)})`;
/** Whether any of the fields that describe the stay's place differ from what the editor opened with. */
export const placeChanged = (values: StayValues, baseline: StayValues) =>
  PLACE_FIELDS.some((name) => values[name] !== baseline[name]);
