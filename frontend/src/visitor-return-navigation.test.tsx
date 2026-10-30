// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it } from "vitest";
import { changeLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import { server } from "./mocks/server";
import { VisitorRoutes } from "./visitor-routes";

afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});

it.each([403, 404, 503])(
  "offers a fixed public-index exit for status %s in both locales",
  async (status) => {
    server.use(http.get("/api/public/trips/example", () => HttpResponse.json({}, { status })));
    render(<VisitorRoutes initialEntries={["/trips/example"]} />);
    expect(
      (await screen.findByRole("link", { name: "Alle openbare reizen" })).getAttribute("href"),
    ).toBe("/trips");
    await screen.findByText(status === 503 ? m.trip_error() : m.unavailable_trip());
    act(() => changeLocale("en"));
    expect(screen.getByRole("link", { name: "All public trips" }).getAttribute("href")).toBe(
      "/trips",
    );
  },
);

it("leaves unavailable unlisted navigation unchanged", async () => {
  server.use(http.get("/api/shared/synthetic-token", () => HttpResponse.json({}, { status: 404 })));
  render(<VisitorRoutes initialEntries={["/share/synthetic-token"]} />);
  await screen.findByText("Deze reis is niet beschikbaar.");
  expect(screen.queryByRole("link", { name: "Alle openbare reizen" })).toBeNull();
});
