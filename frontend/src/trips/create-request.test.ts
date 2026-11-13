import { expect, it } from "vitest";

import type { Location, Stay, Trip } from "../api-types";
import { prefillForLocation, stayOnDay } from "./create-request";
import { emptyPlace, placeOfPrefill } from "./PlacePicker";
import { routeFromPrefill } from "./routes/model";
import { stayFromPrefill } from "./stays/model";
import { visitFromPrefill } from "./visits/model";

const trip = { starts_on: "2054-11-16", ends_on: "2054-11-26" } as Trip;
const stay = (id: string, from: string, to: string, status = "planned", areaId = "taipei") =>
  ({
    id,
    status,
    check_in_date: from,
    check_out_date: to,
    area: { id: areaId },
  }) as unknown as Stay;
const spring = {
  id: "spring",
  area_id: "taipei",
  display_name: "Beitou Hot Spring",
  address_line1: "12 Guangming Road",
  locality: "Taipei",
  country_code: "TW",
} as Location;

it("names a place by its location, else its area, else nothing yet", () => {
  expect(placeOfPrefill({ areaId: "taipei", locationId: "spring" }).choice).toBe("location:spring");
  expect(placeOfPrefill({ areaId: "taipei" }).choice).toBe("area:taipei");
  expect(placeOfPrefill({})).toEqual(emptyPlace());
  expect(prefillForLocation(spring)).toEqual({ areaId: "taipei", locationId: "spring" });
});

it("finds where the owner is on a day: the stay of that night, else the one left that morning", () => {
  const first = stay("s1", "2054-11-16", "2054-11-19", "planned", "taipei");
  const second = stay("s2", "2054-11-19", "2054-11-22", "planned", "tainan");
  const idea = stay("s3", "2054-11-17", "2054-11-18", "idea", "kenting");
  expect(stayOnDay([first, second, idea], "2054-11-17")).toBe(first);
  expect(stayOnDay([first, second], "2054-11-19")).toBe(second);
  expect(stayOnDay([first], "2054-11-19")).toBe(first);
  expect(stayOnDay([first], "2054-11-25")).toBeUndefined();
});

it("fills a new visit and route with the day and place, and leaves the rest as a blank one", () => {
  const visit = visitFromPrefill({ day: "2054-11-18", areaId: "taipei", locationId: "spring" });
  expect(visit).toMatchObject({ startsOn: "2054-11-18", status: "planned" });
  expect(visit.place.choice).toBe("location:spring");
  const route = routeFromPrefill({ day: "2054-11-18", areaId: "taipei" });
  expect(route).toMatchObject({ departsOn: "2054-11-18", mode: "train" });
  expect(route.departure.choice).toBe("area:taipei");
  expect(route.arrival).toEqual(emptyPlace());
  expect(visitFromPrefill({}).startsOn).toBe("");
});

it("fills a new stay with its check-in day, one night, and the accommodation of a saved location", () => {
  expect(stayFromPrefill(trip, { day: "2054-11-18" }, [])).toMatchObject({
    checkInDate: "2054-11-18",
    checkOutDate: "2054-11-19",
    areaId: "",
    location: null,
  });
  expect(stayFromPrefill(trip, { areaId: "taipei" }, [])).toMatchObject({
    checkInDate: "2054-11-16",
    areaId: "taipei",
  });
  expect(stayFromPrefill(trip, { areaId: "taipei", locationId: "spring" }, [spring])).toMatchObject(
    {
      areaId: "taipei",
      propertyName: "Beitou Hot Spring",
      address: "12 Guangming Road",
      location: { existing_location_id: "spring" },
    },
  );
  // A location that has not loaded yet still gives its area.
  expect(stayFromPrefill(trip, { areaId: "taipei", locationId: "spring" }, [])).toMatchObject({
    areaId: "taipei",
    location: null,
  });
});
