// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { changeLocale } from "../../locale";
import type { OverviewWarning, TripOverview } from "../../tracker-model";
import { futureDisclosureLines, SharingReview } from "./SharingReview";

const warning = (overrides: Partial<OverviewWarning>): OverviewWarning => ({
  code: "future_transport_times",
  severity: "warning",
  message: "",
  audience: "public",
  audience_id: null,
  text: null,
  kind: null,
  id: null,
  count: 1,
  ...overrides,
});
const overview = (warnings: OverviewWarning[]): TripOverview => ({
  trip_id: "trip",
  counts: {},
  visibility: {},
  audiences: [],
  warnings,
});

beforeEach(() => {
  act(() => changeLocale("nl"));
});
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});

it("words the future transport and day-date warnings for the Sharing check in Dutch", () => {
  render(
    <SharingReview
      overview={overview([
        warning({ count: 2 }),
        warning({ code: "future_day_dates", count: 3 }),
        warning({
          code: "future_transport_times",
          audience: "Familie",
          audience_id: "l1",
          count: 1,
        }),
      ])}
    />,
  );
  const review = within(screen.getByRole("list", { name: "Controle voor het delen" }));
  expect(
    review.getByText(
      "De pagina voor iedereen kan vóór de reis lezen wanneer en hoe u reist: 2 vervoersverbindingen met tijd of maatschappij. Zet die routes tot uw vertrek op privé.",
    ),
  ).toBeTruthy();
  expect(
    review.getByText(
      "De pagina voor iedereen toont datums per dag bij 3 records met een datum vóór de reis. Zet tot uw vertrek “Datums die dit publiek ziet” op maand.",
    ),
  ).toBeTruthy();
  expect(
    review.getByText(
      "Link “Familie” kan vóór de reis lezen wanneer en hoe u reist: 1 vervoersverbinding met tijd of maatschappij. Zet die routes tot uw vertrek op privé.",
    ),
  ).toBeTruthy();
});

it("words the same warnings in English, with the audience name and the plural by count", () => {
  act(() => changeLocale("en"));
  render(
    <SharingReview
      overview={overview([
        warning({ count: 13 }),
        warning({ code: "future_day_dates", count: 1 }),
        warning({ code: "future_day_dates", audience: "Family", audience_id: "l1", count: 4 }),
      ])}
    />,
  );
  const review = within(screen.getByRole("list", { name: "Sharing check" }));
  expect(
    review.getByText(
      "The page for everyone can read when and how you travel before the trip starts: 13 transport legs with a time or carrier. Until you leave, set those routes to private.",
    ),
  ).toBeTruthy();
  expect(
    review.getByText(
      "The page for everyone shows dates by day for 1 dated record before the trip starts. Until you leave, set “Dates shown to this audience” to month.",
    ),
  ).toBeTruthy();
  expect(
    review.getByText(
      "Link “Family” shows dates by day for 4 dated records before the trip starts. Until you leave, set “Dates shown to this audience” to month.",
    ),
  ).toBeTruthy();
});

it("gives the preview the same lines for a disclosure, and none when the trip shows nothing of the future", () => {
  expect(futureDisclosureLines({ transport: 0, day_dates: 0 }, "Link “Familie”")).toEqual([]);
  expect(futureDisclosureLines({ transport: 1, day_dates: 0 }, "Link “Familie”")).toEqual([
    "Link “Familie” kan vóór de reis lezen wanneer en hoe u reist: 1 vervoersverbinding met tijd of maatschappij. Zet die routes tot uw vertrek op privé.",
  ]);
  act(() => changeLocale("en"));
  expect(futureDisclosureLines({ transport: 2, day_dates: 1 }, "The page for everyone")).toEqual([
    "The page for everyone can read when and how you travel before the trip starts: 2 transport legs with a time or carrier. Until you leave, set those routes to private.",
    "The page for everyone shows dates by day for 1 dated record before the trip starts. Until you leave, set “Dates shown to this audience” to month.",
  ]);
});

it("never echoes owner text: a warning without a count reads as zero, not as the record's name", () => {
  render(
    <SharingReview overview={overview([warning({ count: null, text: "Geheime routetitel" })])} />,
  );
  const review = within(screen.getByRole("list", { name: "Controle voor het delen" }));
  expect(review.queryByText(/Geheime routetitel/)).toBeNull();
  expect(review.getByText(/kan vóór de reis lezen/)).toBeTruthy();
});

it("calls out routes that now follow a month or year audience, in both languages", () => {
  const warnings = [
    warning({ code: "route_dates_follow_audience", severity: "info", text: "month", count: 2 }),
    warning({
      code: "route_dates_follow_audience",
      severity: "info",
      text: "year",
      audience: "Familie",
      audience_id: "l1",
      count: 1,
    }),
  ];
  render(<SharingReview overview={overview(warnings)} />);
  const dutch = within(screen.getByRole("list", { name: "Controle voor het delen" }));
  expect(
    dutch.getByText(
      "Routes volgen nu de datuminstelling van dit publiek: De pagina voor iedereen toont 2 routes per maand, zonder vertrektijden, tot u dagen toestaat.",
    ),
  ).toBeTruthy();
  expect(
    dutch.getByText(
      "Routes volgen nu de datuminstelling van dit publiek: Link “Familie” toont 1 route per jaar, zonder vertrektijden, tot u dagen toestaat.",
    ),
  ).toBeTruthy();
  cleanup();
  act(() => changeLocale("en"));
  render(<SharingReview overview={overview(warnings)} />);
  const english = within(screen.getByRole("list", { name: "Sharing check" }));
  expect(
    english.getByText(
      "Routes now follow this audience’s date setting: The page for everyone shows 2 routes by month, without departure times, until you allow days.",
    ),
  ).toBeTruthy();
});
