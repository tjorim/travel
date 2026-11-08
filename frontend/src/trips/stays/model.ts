import { m } from "../../paraglide/messages.js";
import {
  addDays,
  formatDay,
  locationName,
  stayLabel,
  type DatePrecision,
  type Location,
  type LocationInput,
  type Stay,
  type Trip,
} from "../../tracker-model";
import type { FormContext } from "../../forms/form-context";
import type { CreatePrefill } from "../create-request";

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
  /** The stay's area: required while there is no accommodation; follows the accommodation once there is one. */
  areaId: string;
  location: LocationInput | null;
  bookingReference: string;
  contactDetails: string;
  notes: string;
  /** The trip documents attached to the stay (owner-only). */
  documentAssetIds: string[];
  /** Empty follows each audience's own date precision. */
  shareDatePrecision: DatePrecision | "";
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
    areaId: "",
    location: null,
    bookingReference: "",
    contactDetails: "",
    notes: "",
    documentAssetIds: [],
    shareDatePrecision: "",
  };
};
/**
 * A new stay that checks in on the day and sits in the area (and, for a saved location, at the accommodation)
 * an in-place start names. A location fills the same fields choosing it in the search would.
 */
export const stayFromPrefill = (
  trip: Trip,
  prefill: CreatePrefill,
  locations: readonly Location[],
): StayValues => {
  const blankValues = blankStay(trip);
  const checkInDate = prefill.day ?? blankValues.checkInDate;
  const location = prefill.locationId
    ? locations.find((candidate) => candidate.id === prefill.locationId)
    : undefined;
  return {
    ...blankValues,
    checkInDate,
    checkOutDate: addDays(checkInDate, 1),
    areaId: location?.area_id ?? prefill.areaId ?? "",
    ...(location
      ? {
          propertyName: location.display_name ?? "",
          address: location.address_line1 ?? "",
          locality: location.locality ?? "",
          countryCode: location.country_code ?? "",
          location: { existing_location_id: location.id },
        }
      : {}),
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
  areaId: stay.area.id,
  location: locationInput(stay.location),
  bookingReference: stay.booking_reference ?? "",
  contactDetails: stay.contact_details ?? "",
  notes: stay.notes ?? "",
  documentAssetIds: [...stay.document_asset_ids],
  shareDatePrecision: stay.share_date_precision ?? "",
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
  document_asset_ids: "documentAssetIds",
  share_date_precision: "shareDatePrecision",
};
export const PLACE_FIELDS = [
  "propertyName",
  "address",
  "locality",
  "countryCode",
  "areaId",
  "location",
] as const;

export const checkOutAfterCheckIn = ({ value, fieldApi }: { value: string } & FormContext) =>
  value && value <= String(fieldApi.form.getFieldValue("checkInDate" as never) ?? "")
    ? m.owner_check_out_is_no_earlier_than_the_morning_after_the_first_night
    : undefined;
export const PLACE_REQUIRED = m.owner_choose_the_area_of_this_stay_or_search_for_the_accommodation;
export const httpsOnly = ({ value }: { value: string }) =>
  value.trim() && !value.trim().startsWith("https://") ? m.owner_use_an_https_address : undefined;

export const locationLine = (place: Stay["location"] | undefined) =>
  place ? [...new Set([locationName(place), place.locality].filter(Boolean))].join(" · ") : "";
export const overlaps = (stay: Stay, checkIn: string, checkOut: string) =>
  stay.check_in_date < checkOut && checkIn < stay.check_out_date;
export const overlapLabel = (stay: Stay) =>
  `${stayLabel(stay)} (${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)})`;
/** Whether any of the fields that describe the stay's place differ from what the editor opened with. */
export const placeChanged = (values: StayValues, baseline: StayValues) =>
  PLACE_FIELDS.some((name) => values[name] !== baseline[name]);

/**
 * What the editor describes of the accommodation: a saved location, a new one (a search result or an
 * address) or nothing yet. A name or a city alone does not make a location: the stay keeps its
 * property name, and without an address it is filed under its area alone.
 */
export const accommodationOf = (values: StayValues): "saved" | "new" | "none" =>
  values.location?.existing_location_id
    ? "saved"
    : values.location || values.address.trim()
      ? "new"
      : "none";

/** The place fields of a stay request: its accommodation with the area it settles, or its area alone. */
export function stayPlaceFields(values: StayValues): Record<string, unknown> {
  const accommodation = accommodationOf(values);
  if (accommodation === "saved")
    return { location: { existing_location_id: values.location!.existing_location_id } };
  if (accommodation === "new")
    return {
      location: {
        ...values.location,
        display_name: values.propertyName.trim() || null,
        address_line1: values.address.trim() || null,
        locality: values.locality.trim() || null,
        country_code: values.countryCode.trim().toUpperCase() || null,
        ...(values.areaId ? { area_id: values.areaId } : {}),
      },
    };
  return { area_id: values.areaId, location: null };
}

/** The accommodation line of a stay: its location, or that none is chosen yet. */
export const accommodationLine = (stay: Pick<Stay, "location">) =>
  stay.location ? locationLine(stay.location) : m.owner_accommodation_not_chosen_yet();
