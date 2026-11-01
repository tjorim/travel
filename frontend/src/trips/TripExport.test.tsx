// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { TripExport } from "./TripExport";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const notices: string[] = [];
const render = () =>
  renderRoutesWithOwner(
    createRootRoute({
      component: () => (
        <TripExport tripId="trip-1" onNotice={(notice) => notices.push(notice.message())} />
      ),
    }),
    ["/"],
  );

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  notices.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("downloads the export through an authenticated request with no token in the URL", async () => {
  let seen: { url: string; authorization: string | null } | null = null;
  server.use(
    http.get("*/api/trips/trip-1/export", ({ request }) => {
      seen = { url: request.url, authorization: request.headers.get("authorization") };
      return HttpResponse.json({ schema_version: "travel/trip-export@1" });
    }),
  );
  const created: Blob[] = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => (created.push(blob), "blob:export"),
      revokeObjectURL: () => undefined,
    }),
  );
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  render();

  fireEvent.click(await screen.findByRole("button", { name: "Reisgegevens exporteren (JSON)" }));

  await waitFor(() => expect(downloads).toEqual(["trip-trip-1-export.json"]));
  expect(created[0]?.type).toBe("application/json");
  expect(seen).toMatchObject({ authorization: expect.stringMatching(/^Bearer /) });
  expect(String((seen as { url: string } | null)?.url)).not.toMatch(/token|access/i);
  await waitFor(() => expect(notices).toEqual(["Reisgegevens geëxporteerd."]));
});

it("shows pending state, then a translated error without server prose", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  server.use(
    http.get("*/api/trips/trip-1/export", async () => {
      await gate;
      return HttpResponse.json({ detail: "Internal secret prose" }, { status: 500 });
    }),
  );
  render();

  fireEvent.click(await screen.findByRole("button", { name: "Reisgegevens exporteren (JSON)" }));
  const pending = await screen.findByRole("button", { name: /Reisgegevens exporteren…/ });
  expect((pending as HTMLButtonElement).disabled).toBe(true);
  release();

  expect((await screen.findByRole("alert")).textContent).toMatch(
    /^De reisgegevens konden niet worden geëxporteerd\./,
  );
  expect(screen.queryByText(/Internal secret prose/)).toBeNull();
  expect(notices).toEqual([]);
});
