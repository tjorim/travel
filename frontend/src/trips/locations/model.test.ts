import { expect, it } from "vitest";

import {
  ownerLocationName,
  type Location,
  type PublicProjectionStatus,
  type ShareLink,
} from "../../tracker-model";
import {
  address,
  addressProjection,
  blank,
  fromPlace,
  matchableLocationName,
  pendingVisitorFields,
  projectionText,
  recipients,
  shareableAddress,
  visitorReview,
} from "./model";
import { ApiError } from "../../query/api";

const place = (fields: Partial<Location> = {}) =>
  ({
    id: "l1",
    area_id: "a1",
    display_name: "Main Station, Taipei",
    label: null,
    address_line1: "1 Zhongxiao W Rd",
    address_line2: null,
    postal_code: null,
    locality: "Taipei",
    admin_area: null,
    country_code: "TW",
    notes: null,
    share_address: false,
    visibility: "private",
    ...fields,
  }) as Location;

it("names a location by its first display-name segment, and only matches named ones", () => {
  expect(ownerLocationName(place())).toBe("Main Station");
  expect(matchableLocationName(place())).toBe("Main Station");
  expect(matchableLocationName(place({ display_name: null, label: null, locality: null }))).toBe(
    "",
  );
});

it("describes the address the same way for a saved location and for editor values", () => {
  const saved = place();
  const values = fromPlace(saved);
  expect(address(saved)).toBe("1 Zhongxiao W Rd, Taipei");
  expect(address(values)).toBe(address(saved));
  expect(addressProjection(values)).toEqual(addressProjection(saved));
  expect(shareableAddress(values)).toBe(true);
  expect(shareableAddress(blank("a1"))).toBe(false);
  expect(blank("a1").areaId).toBe("a1");
  expect(projectionText(addressProjection(saved))).toContain("1 Zhongxiao W Rd");
});

it("lists who a location currently reaches", () => {
  const status = {
    surface_state: "published",
    scope: { items: [{ kind: "location", id: "l1" }] },
  } as unknown as PublicProjectionStatus;
  const link = (fields: Partial<ShareLink> = {}) =>
    ({
      state: "active",
      label: "Family",
      expires_at: null,
      scope: { items: [{ kind: "location", id: "l1" }] },
      ...fields,
    }) as unknown as ShareLink;
  const custom = place({ visibility: "custom" });
  expect(recipients(place({ visibility: "private" }), status, [link()])).toEqual([]);
  expect(recipients(custom, status, [link()])).toHaveLength(2);
  expect(recipients(place({ visibility: "everyone" }), undefined, [])).toEqual([]);
  expect(recipients(place({ visibility: "everyone" }), status, [])).toHaveLength(1);
  expect(recipients(custom, status, [link({ state: "revoked" })])).toHaveLength(1);
  expect(recipients(custom, status, [link({ expires_at: "2000-01-01T00:00:00Z" })])).toHaveLength(
    1,
  );
  expect(
    recipients(custom, status, [
      link({ scope: { items: [{ kind: "location", id: "other" }] } } as Partial<ShareLink>),
    ]),
  ).toHaveLength(1);
});

it("lists only the changed fields visitors read, and the address only while it is shared", () => {
  const saved = place({ label: "Hotel", country_code: "TW", share_address: false });
  const edited = {
    ...fromPlace(saved),
    label: "Hotel 2",
    countryCode: "tw",
    addressLine1: "Elders",
  };
  // The address is private, so changing it changes nothing visitors read.
  expect(pendingVisitorFields(saved, edited)).toEqual(["label"]);
  expect(pendingVisitorFields(saved, { ...edited, shareAddress: true })).toEqual([
    "label",
    "address_line1",
  ]);
  expect(
    pendingVisitorFields(place({ share_address: true }), {
      ...fromPlace(place()),
      shareAddress: false,
    }),
  ).toEqual(["address_line1"]);
  expect(pendingVisitorFields(saved, { ...edited, label: "Hotel", addressLine1: "" })).toEqual([]);
});

it("reads a visitor review only from the server's 409 with that code", () => {
  const conflict = (diagnostic: unknown, status = 409) =>
    new ApiError("fallback", status, [], diagnostic);
  const change = {
    field: "label",
    before: "A",
    after: "B",
    audiences: [{ id: "public", label: null }],
  };
  expect(
    visitorReview(
      conflict({ code: "visitor_visible_change_needs_acknowledgement", changes: [change] }),
    ),
  ).toMatchObject([{ field: "label", before: "A", after: "B" }]);
  expect(visitorReview(conflict({ code: "other", changes: [change] }))).toBeNull();
  expect(
    visitorReview(
      conflict({ code: "visitor_visible_change_needs_acknowledgement", changes: [change] }, 422),
    ),
  ).toBeNull();
  expect(
    visitorReview(
      conflict({
        code: "visitor_visible_change_needs_acknowledgement",
        changes: [{ ...change, field: "notes" }],
      }),
    ),
  ).toBeNull();
  expect(visitorReview(new Error("x"))).toBeNull();
});
