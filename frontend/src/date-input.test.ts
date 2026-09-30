import { expect, it } from "vitest";

import { formatDateInput, joinDateTime, parseDateInput, parseTimeInput, splitDateTime } from "./date-input";

it("reads a date from the displayed form, day-first numbers and ISO", () => {
  for (const text of [
    "16 nov 2054",
    "16 Nov 2054",
    "16 november 2054",
    "16 nov. 2054",
    "16nov2054",
    "16-11-2054",
    "16/11/2054",
    "16.11.2054",
    "2054-11-16",
    " 2054-11-16 ",
  ])
    expect(parseDateInput(text), text).toBe("2054-11-16");
  expect(parseDateInput("5 mrt 2055")).toBe("2055-03-05");
  expect(parseDateInput("5 mar 2055")).toBe("2055-03-05");
  expect(parseDateInput("5 maart 2055")).toBe("2055-03-05");
  expect(parseDateInput("1 mei 2055")).toBe("2055-05-01");
  expect(parseDateInput("1 may 2055")).toBe("2055-05-01");
});

it("rejects text that is not a real date", () => {
  for (const text of ["", "16 nov", "31-02-2054", "2054-02-30", "32 nov 2054", "16 xyz 2054", "16 ma 2054", "11/16/26"])
    expect(parseDateInput(text), text).toBeNull();
});

it("shows a date in the interface language", () => {
  expect(formatDateInput("2054-11-16", "nl")).toBe("16 nov 2054");
  expect(formatDateInput("2054-03-05", "nl")).toBe("5 mrt 2054");
  expect(formatDateInput("2054-03-05", "en")).toBe("5 Mar 2054");
  expect(formatDateInput("", "nl")).toBe("");
});

it("reads a 24-hour time, and a 12-hour time with am or pm", () => {
  expect(parseTimeInput("18:30")).toBe("18:30");
  expect(parseTimeInput("9:05")).toBe("09:05");
  expect(parseTimeInput("0930")).toBe("09:30");
  expect(parseTimeInput("930")).toBe("09:30");
  expect(parseTimeInput("18.30")).toBe("18:30");
  expect(parseTimeInput("18")).toBe("18:00");
  expect(parseTimeInput("6:30 pm")).toBe("18:30");
  expect(parseTimeInput("12 am")).toBe("00:00");
  expect(parseTimeInput("12:15pm")).toBe("12:15");
});

it("rejects text that is not a time", () => {
  for (const text of ["", "24:00", "18:60", "18:", "abc", "13 pm", "183"])
    expect(parseTimeInput(text), text).toBeNull();
});

it("splits and joins a date-time value", () => {
  expect(splitDateTime("2054-11-16T10:40")).toEqual({ date: "2054-11-16", time: "10:40" });
  expect(splitDateTime("")).toEqual({ date: "", time: "" });
  expect(joinDateTime("2054-11-16", "10:40")).toBe("2054-11-16T10:40");
  expect(joinDateTime("2054-11-16", "")).toBe("");
});
