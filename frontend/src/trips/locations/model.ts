import { m } from "../../paraglide/messages.js";
import { ApiError } from "../../query/api";
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

/** A field visitors read, as the API names it: what the location editor and the server's review both list. */
export type VisitorField =
  | "label"
  | "locality"
  | "country_code"
  | "address_line1"
  | "address_line2"
  | "postal_code"
  | "admin_area"
  | "area_id";
export type Audience = { id: string; label: string | null };
/** One visitor-facing change the server asks the owner to acknowledge, with who reads it. */
export type VisitorChange = {
  field: VisitorField;
  before: string | null;
  after: string | null;
  audiences: Audience[];
  /** Only an area move: the area names, and how many visits and route ends travel with the location. */
  before_label?: string | null;
  after_label?: string | null;
  visits?: number;
  routes?: number;
};
const VISITOR_FIELDS: VisitorField[] = [
  "label",
  "locality",
  "country_code",
  "address_line1",
  "address_line2",
  "postal_code",
  "admin_area",
  "area_id",
];
export const VISITOR_CHANGE_CODE = "visitor_visible_change_needs_acknowledgement";

/** The review a 409 carries, or null for any other failure; anything malformed is not a review. */
export function visitorReview(error: unknown): VisitorChange[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.diagnostic as { code?: unknown; changes?: unknown } | null;
  if (detail?.code !== VISITOR_CHANGE_CODE || !Array.isArray(detail.changes)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const changes: VisitorChange[] = [];
  for (const change of detail.changes as Record<string, unknown>[]) {
    if (!VISITOR_FIELDS.includes(change?.field as VisitorField) || !Array.isArray(change.audiences))
      return null;
    changes.push({
      field: change.field as VisitorField,
      before: text(change.before),
      after: text(change.after),
      audiences: (change.audiences as Audience[]).map((audience) => ({
        id: String(audience.id),
        label: text(audience.label),
      })),
      before_label: text(change.before_label),
      after_label: text(change.after_label),
      visits: typeof change.visits === "number" ? change.visits : undefined,
      routes: typeof change.routes === "number" ? change.routes : undefined,
    });
  }
  return changes.length ? changes : null;
}

const FIELD_LABELS: Record<VisitorField, () => string> = {
  label: m.owner_public_name_2,
  locality: m.owner_city,
  country_code: m.owner_country_code,
  address_line1: m.owner_address_line_1,
  address_line2: m.owner_address_line_2,
  postal_code: m.owner_postal_code,
  admin_area: m.owner_region,
  area_id: m.owner_area,
};
export const isVisitorField = (field: string): field is VisitorField =>
  VISITOR_FIELDS.includes(field as VisitorField);
export const visitorFieldLabel = (field: VisitorField) => FIELD_LABELS[field]();
/** An audience by the owner's words: the public page, or the share link's own label. */
export const audienceName = (audience: Audience) =>
  audience.id === "public"
    ? m.owner_public_page()
    : m.owner_share_link({ p0: audience.label ?? "" });

const ADDRESS_VALUES: [VisitorField, keyof Values][] = [
  ["address_line1", "addressLine1"],
  ["address_line2", "addressLine2"],
  ["postal_code", "postalCode"],
  ["admin_area", "adminArea"],
];
/** The text fields of a location as visitors read them: the address parts only while it is shared. */
function visitorText(values: Values): Partial<Record<VisitorField, string | null>> {
  const shown: Partial<Record<VisitorField, string | null>> = {
    label: optional(values.label),
    locality: optional(values.locality),
    country_code: optional(values.countryCode)?.toUpperCase() ?? null,
  };
  if (values.shareAddress)
    for (const [field, key] of ADDRESS_VALUES) shown[field] = optional(String(values[key]));
  return shown;
}

/** Which visitor-facing text fields the editor's values change on a saved location (the server decides who must confirm). */
export function pendingVisitorFields(place: Location, values: Values): VisitorField[] {
  const before = visitorText(fromPlace(place));
  const after = visitorText(values);
  return VISITOR_FIELDS.filter(
    (field) => field !== "area_id" && (before[field] ?? null) !== (after[field] ?? null),
  );
}
