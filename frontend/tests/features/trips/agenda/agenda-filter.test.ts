// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import {
  agendaFilterKey,
  isFiltered,
  NO_FILTER,
  readAgendaFilter,
  writeAgendaFilter,
} from "@/features/trips/agenda/agenda-filter";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("remembers a filter per trip and forgets it once nothing is chosen", () => {
  writeAgendaFilter("a", { kinds: ["stay"], statuses: ["idea", "cancelled"] });
  expect(readAgendaFilter("a")).toEqual({ kinds: ["stay"], statuses: ["idea", "cancelled"] });
  expect(readAgendaFilter("b")).toEqual(NO_FILTER);
  writeAgendaFilter("a", NO_FILTER);
  expect(localStorage.getItem(agendaFilterKey("a"))).toBeNull();
  expect(isFiltered(NO_FILTER)).toBe(false);
  expect(isFiltered({ kinds: ["visit"], statuses: [] })).toBe(true);
});

it("keeps only the choices it knows and ignores what it cannot read", () => {
  localStorage.setItem(
    agendaFilterKey("a"),
    JSON.stringify({ kinds: ["route", "boat", 3], statuses: "idea", other: true }),
  );
  expect(readAgendaFilter("a")).toEqual({ kinds: ["route"], statuses: [] });
  for (const stored of ["{broken", "null", "[]", '"stay"', "7"]) {
    localStorage.setItem(agendaFilterKey("a"), stored);
    expect(readAgendaFilter("a")).toEqual(NO_FILTER);
  }
});

it("never throws when the browser denies storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(readAgendaFilter("a")).toEqual(NO_FILTER);
  expect(() => writeAgendaFilter("a", { kinds: ["visit"], statuses: [] })).not.toThrow();
  expect(() => writeAgendaFilter("a", NO_FILTER)).not.toThrow();
});
