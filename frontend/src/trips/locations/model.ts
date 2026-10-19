import { m } from "../../paraglide/messages.js";
import {
  ownerLocationName,
  type Location,
  type PublicProjectionStatus,
  type ShareLink,
} from "../../tracker-model";

export type Values = {
  areaId: string;
  displayName: string;
  label: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  adminArea: string;
  postalCode: string;
  countryCode: string;
  notes: string;
  shareAddress: boolean;
};
export const blank = (areaId = ""): Values => ({
  areaId,
  displayName: "",
  label: "",
  addressLine1: "",
  addressLine2: "",
  locality: "",
  adminArea: "",
  postalCode: "",
  countryCode: "",
  notes: "",
  shareAddress: false,
});
export const fromPlace = (place: Location): Values => ({
  areaId: place.area_id,
  displayName: place.display_name ?? "",
  label: place.label ?? "",
  addressLine1: place.address_line1 ?? "",
  addressLine2: place.address_line2 ?? "",
  locality: place.locality ?? "",
  adminArea: place.admin_area ?? "",
  postalCode: place.postal_code ?? "",
  countryCode: place.country_code ?? "",
  notes: place.notes ?? "",
  shareAddress: place.share_address,
});
const addressFields = (value: Values | Location) =>
  "addressLine1" in value
    ? [value.addressLine1, value.addressLine2, value.postalCode, value.locality, value.adminArea]
    : [
        value.address_line1,
        value.address_line2,
        value.postal_code,
        value.locality,
        value.admin_area,
      ];
export const address = (value: Values | Location) =>
  addressFields(value).filter(Boolean).join(", ");
export const shareableAddress = (value: Values | Location) => addressFields(value).some(Boolean);
export const addressProjection = (value: Values | Location) => {
  const fields =
    "addressLine1" in value
      ? {
          line1: value.addressLine1,
          line2: value.addressLine2,
          postal_code: value.postalCode,
          locality: value.locality,
          admin_area: value.adminArea,
        }
      : {
          line1: value.address_line1,
          line2: value.address_line2,
          postal_code: value.postal_code,
          locality: value.locality,
          admin_area: value.admin_area,
        };
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => field?.trim()));
};
const PROJECTION_LABELS: Record<string, () => string> = {
  line1: m.owner_address_line_1,
  line2: m.owner_address_line_2,
  postal_code: m.owner_postal_code,
  locality: m.owner_city,
  admin_area: m.owner_region,
};
/** The address field visitors would receive, as words rather than the API's JSON. */
export const projectionText = (projection: Record<string, string | null | undefined>) =>
  Object.entries(projection)
    .map(([key, field]) => `${PROJECTION_LABELS[key]?.() ?? key}: ${field?.trim()}`)
    .join("; ");
export function recipients(
  place: Location,
  status: PublicProjectionStatus | undefined,
  links: ShareLink[] | undefined,
): string[] {
  if (place.visibility === "private") return [];
  const included = (scope: PublicProjectionStatus["scope"]) =>
    place.visibility === "everyone" ||
    scope.items?.some((item) => item.kind === "location" && item.id === place.id);
  const now = Date.now();
  return [
    ...(status?.surface_state === "published" && included(status.scope)
      ? [m.owner_public_page()]
      : []),
    ...(links ?? [])
      .filter(
        (link) =>
          link.state === "active" &&
          (!link.expires_at || Date.parse(link.expires_at) > now) &&
          included(link.scope),
      )
      .map((link) => m.owner_share_link({ p0: link.label })),
  ];
}
/** The name two locations are compared by; an unnamed location has none, so it never matches by name. */
export const matchableLocationName = (place: Location) =>
  place.display_name || place.label || place.locality ? ownerLocationName(place) : "";
export const optional = (value: string) => value.trim() || null;
export const serverFields = {
  area_id: "areaId",
  display_name: "displayName",
  label: "label",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  locality: "locality",
  admin_area: "adminArea",
  postal_code: "postalCode",
  country_code: "countryCode",
  notes: "notes",
};

/** Whether the recipients behind a location are still loading, could not be read, or are known. */
export type RecipientState = "loading" | "failed" | "ready";
