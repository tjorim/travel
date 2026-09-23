// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LocalTimes } from "./TripOverview";
import { offsetLabel, utcOffsetMinutes, whereabouts, type Place, type Stay, type TransportLeg } from "../tracker-model";

afterEach(cleanup);

const home = "Europe/Brussels";
const place = (locality: string) => ({ locality, display_name: locality }) as Place;
const city = (label: string) => ({ id: label, label, country_code: "TW", region: null, latitude: null, longitude: null, timezone: "Asia/Taipei" });

function stay(label: string, check_in_date: string, check_out_date: string): Stay {
  return { id: label, check_in_date, check_out_date, check_in_time: null, check_out_time: null, status: "booked", property_name: label, website_url: null, booking_reference: null, contact_details: null, notes: null, place: null, broad_place: city(label) };
}

function leg(from: string, to: string, departs_at: string, arrives_at: string, departure_timezone: string, arrival_timezone: string): TransportLeg {
  return { id: `${from}-${to}`, kind: "flight", status: "booked", departure_place: place(from), arrival_place: place(to), departs_at, arrives_at, departure_timezone, arrival_timezone, carrier: null, service_reference: null, travel_class: null, booking_reference: null, notes: null, document_asset_ids: [] };
}

const stays = [stay("Linkou", "2054-11-16", "2054-11-28"), stay("Alishan", "2054-11-29", "2054-11-30")];
const legs = [
  leg("Amsterdam", "Taoyuan", "2054-11-16T09:40:00Z", "2054-11-16T22:25:00Z", "Europe/Amsterdam", "Asia/Taipei"),
  leg("Taoyuan", "Amsterdam", "2054-12-06T15:15:00Z", "2054-12-07T06:50:00Z", "Asia/Taipei", "Europe/Amsterdam"),
];

it("includes daylight saving in each zone's offset", () => {
  expect(utcOffsetMinutes("2054-09-23T10:00:00Z", home)).toBe(120);
  expect(utcOffsetMinutes("2054-11-20T10:00:00Z", home)).toBe(60);
  expect(utcOffsetMinutes("2054-11-20T10:00:00Z", "Asia/Taipei")).toBe(480);
  expect(offsetLabel(330)).toBe("5 u 30 min later dan hier");
  expect(offsetLabel(-60)).toBe("1 u eerder dan hier");
  expect(offsetLabel(0)).toBe("zelfde tijd als hier");
});

it("follows the owner through the plan", () => {
  expect(whereabouts("2054-09-23T10:00:00Z", stays, legs, home).kind).toBe("home");
  expect(whereabouts("2054-11-16T12:00:00Z", stays, legs, home)).toEqual({ kind: "travel", zone: "Asia/Taipei", label: "onderweg naar Taoyuan" });
  expect(whereabouts("2054-11-20T13:00:00Z", stays, legs, home)).toEqual({ kind: "stay", zone: "Asia/Taipei", label: "Linkou" });
  // 09:00 on 28 Nov in Taipei: still the Linkou night before check-out.
  expect(whereabouts("2054-11-28T01:00:00Z", stays, legs, home).label).toBe("Linkou");
  // 18:00 on 28 Nov: no stay booked for that night yet.
  expect(whereabouts("2054-11-28T10:00:00Z", stays, legs, home)).toEqual({ kind: "between", zone: "Asia/Taipei", label: "tussen verblijven, laatst in Linkou" });
  expect(whereabouts("2054-12-07T10:00:00Z", stays, legs, home).kind).toBe("home");
});

it("shows the trip's own offset before departure and the live local time during it", () => {
  render(<LocalTimes trip={{ starts_on: "2054-11-16" }} stays={stays} legs={legs} now={new Date("2054-09-23T10:00:00Z")} homeZone={home} />);
  expect(screen.getByText("Tijdens de reis: 7 u later dan hier (nu 6 u later)")).toBeTruthy();
  cleanup();
  render(<LocalTimes trip={{ starts_on: "2054-11-16" }} stays={stays} legs={legs} now={new Date("2054-11-20T13:00:00Z")} homeZone={home} />);
  expect(screen.getByText(/^Nu in Linkou: vr\.? 21:00 · 7 u later dan hier$/)).toBeTruthy();
});
