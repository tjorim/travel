import { expect, it } from "vitest";
import { dayjs } from "../dayjs";
import { formatDay } from "../tracker-model";
import { isOverdue, tripDay, tripProgress } from "./readiness";

it("uses the local calendar around midnight and excludes completed and today's tasks", () => {
  const instant = new Date("2026-11-06T00:30:00Z");
  expect(tripDay(instant, [], [], "America/New_York")).toBe("2026-11-05");
  expect(tripDay(instant, [], [], "Asia/Tokyo")).toBe("2026-11-06");
  expect(isOverdue({ due_date: "2026-11-05", completed_at: null }, "2026-11-06")).toBe(true);
  expect(isOverdue({ due_date: "2026-11-06", completed_at: null }, "2026-11-06")).toBe(false);
  expect(
    isOverdue({ due_date: "2026-11-05", completed_at: "2026-11-05T12:00:00Z" }, "2026-11-06"),
  ).toBe(false);
});
it("counts inclusive trip days across daylight saving and finishes after the final day", () => {
  expect(tripProgress("2026-10-24", "2026-10-27", "2026-10-23")).toEqual({
    kind: "before",
    days: 1,
  });
  expect(tripProgress("2026-10-24", "2026-10-27", "2026-10-26")).toEqual({
    kind: "underway",
    day: 3,
    total: 4,
  });
  expect(tripProgress("2026-10-24", "2026-10-27", "2026-10-27")?.kind).toBe("underway");
  expect(tripProgress("2026-10-24", "2026-10-27", "2026-10-28")?.kind).toBe("finished");
});
it("formats task dates in Dutch and English", () => {
  const previous = dayjs.locale();
  dayjs.locale("nl");
  expect(formatDay("2026-10-02")).toBe("2 okt");
  dayjs.locale("en");
  expect(formatDay("2026-10-02")).toBe("2 Oct");
  dayjs.locale(previous);
});
