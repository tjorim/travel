// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { server } from "./mocks/server";
import { m } from "./paraglide/messages.js";
import type { Projection } from "./ProjectionView";
import {
  forgetAllSharedTrips,
  readSavedSharedTrips,
  rememberSharedTrip,
} from "./saved-shared-trips";
import { VisitorRoutes } from "./visitor-routes";

const token = "synthetic-saved-trip-capability";
const projection: Projection = {
  schema_version: "travel/unlisted-trip@1",
  title: "Stored title",
  summary: "Stored private summary",
  dates: null,
  navigation: [],
  visits: [],
  places: [],
  updates: [],
  stays: [],
  routes: [],
  media: [],
};

function index() {
  server.use(http.get("/api/public/trips", () => HttpResponse.json([])));
  return render(<VisitorRoutes initialEntries={["/trips/"]} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  act(() => changeLocale("nl"));
});

it.each([
  ["revoked", 404],
  ["expired", 404],
  ["rotated", 404],
  ["forbidden", 403],
] as const)(
  "forgets %s links without ever rendering their stored content",
  async (_reason, status) => {
    rememberSharedTrip(token, projection);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.get(`/api/shared/${token}`, async () => {
        await pending;
        return new HttpResponse(null, { status });
      }),
    );
    index();
    await screen.findByText(m.saved_notice());
    expect(document.body.textContent).not.toContain(projection.title);
    expect(document.body.textContent).not.toContain(projection.summary);
    finish();
    await waitFor(() => expect(readSavedSharedTrips()).toEqual([]));
    expect(screen.queryByRole("region", { name: m.saved_trips_label() })).toBeNull();
  },
);

it("shows only freshly selected fields after validation with private request options", async () => {
  rememberSharedTrip(token, projection);
  const fetcher = vi.spyOn(globalThis, "fetch");
  server.use(
    http.get(`/api/shared/${token}`, () =>
      HttpResponse.json({
        ...projection,
        title: "Current title",
        summary: null,
      }),
    ),
  );
  index();
  await screen.findByRole("link", { name: /Current title/ });
  expect(document.body.textContent).not.toContain(projection.summary);
  expect(fetcher).toHaveBeenCalledWith(
    `/api/shared/${token}`,
    expect.objectContaining({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    }),
  );
  act(() => changeLocale("en"));
  expect(screen.getByText(m.saved_notice())).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: m.forget_all_trips() }));
  expect(readSavedSharedTrips()).toEqual([]);
  expect(screen.queryByRole("link", { name: /Current title/ })).toBeNull();
});

it.each([503, "offline", "malformed"])(
  "retains but hides unchecked entries on %s",
  async (failure) => {
    rememberSharedTrip(token, projection);
    server.use(
      http.get(`/api/shared/${token}`, () =>
        failure === "offline"
          ? HttpResponse.error()
          : HttpResponse.json({}, { status: typeof failure === "number" ? failure : 200 }),
      ),
    );
    index();
    await screen.findByText(m.no_public_trips());
    expect(document.body.textContent).not.toContain(projection.title);
    expect(document.body.textContent).not.toContain(projection.summary);
    expect(readSavedSharedTrips()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: m.forget_all_trips() }));
    expect(readSavedSharedTrips()).toEqual([]);
  },
);

it("hides revoked content even when storage cannot be updated", async () => {
  rememberSharedTrip(token, projection);
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
    setItem: () => {
      throw new Error("full");
    },
  });
  expect(rememberSharedTrip("another-synthetic-capability", projection)).toBe(false);
  server.use(http.get(`/api/shared/${token}`, () => new HttpResponse(null, { status: 404 })));
  index();
  await screen.findByText(m.visitor_storage_failed());
  expect(document.body.textContent).not.toContain(projection.title);
  expect(document.body.textContent).not.toContain(projection.summary);
  // Removing the key still works when writing another value would exceed quota.
  fireEvent.click(screen.getByRole("button", { name: m.forget_all_trips() }));
  expect(readSavedSharedTrips()).toEqual([]);
});

it("survives disabled storage and reports failed Forget all without claiming removal", async () => {
  rememberSharedTrip(token, projection);
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: () => {
      throw new Error("disabled");
    },
  });
  server.use(http.get(`/api/shared/${token}`, () => HttpResponse.json(projection)));
  index();
  await screen.findByRole("link", { name: /Stored title/ });
  fireEvent.click(screen.getByRole("button", { name: m.forget_all_trips() }));
  expect(screen.getByText(m.visitor_storage_failed())).toBeTruthy();
  expect(readSavedSharedTrips()).toHaveLength(1);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("disabled");
    },
    setItem: () => {
      throw new Error("disabled");
    },
    removeItem: () => {
      throw new Error("disabled");
    },
  });
  expect(readSavedSharedTrips()).toEqual([]);
  expect(rememberSharedTrip(token, projection)).toBe(false);
  expect(forgetAllSharedTrips()).toBe(false);
});
