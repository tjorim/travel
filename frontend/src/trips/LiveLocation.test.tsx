// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../mocks/server";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { m } from "../paraglide/messages.js";
import { LiveLocation } from "./LiveLocation";
import { SharingReview } from "./publication/SharingReview";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(cleanup);

it("keeps source setup disabled and precision opt-in, with guarded edits and deletion", async () => {
  const row = {
    id: "source-one",
    source: "person.synthetic",
    enabled: false,
    audiences: {},
    current: null,
    stale: false,
  };
  const writes: unknown[] = [];
  server.use(
    http.get("*/api/trips/trip-one/live-location", () => HttpResponse.json([row])),
    http.get("*/api/trips/trip-one/share-links", () =>
      HttpResponse.json([{ id: "link-one", label: "Synthetic family" }]),
    ),
    http.put("*/api/trips/trip-one/live-location/source-one", async ({ request }) => {
      const data = await request.json();
      writes.push(data);
      return HttpResponse.json({ ...row, ...(data as object) });
    }),
    http.delete("*/api/trips/trip-one/live-location/source-one/tracks", () => {
      writes.push("delete");
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderRoutesWithOwner(createRootRoute({ component: () => <LiveLocation tripId="trip-one" /> }), [
    "/",
  ]);
  fireEvent.click(await screen.findByRole("button", { name: m.live_title() }));
  expect(await screen.findByText("person.synthetic")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: m.live_configure() }));
  fireEvent.click(
    await screen.findAllByRole("radio", { name: m.live_1km() }).then((rows) => rows[0]),
  );
  fireEvent.click(screen.getByRole("radio", { name: m.live_delay_value({ minutes: "30" }) }));
  fireEvent.click(screen.getByRole("button", { name: m.live_save() }));
  await waitFor(() =>
    expect(writes).toEqual([
      { enabled: false, audiences: { public: "1km" }, delays: { public: 1800 } },
    ]),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: m.live_delete_tracks() }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(m.live_delete_warning());
  fireEvent.click(screen.getByRole("button", { name: m.owner_delete() }));
  await waitFor(() => expect(writes).toContain("delete"));
});

it("keeps a new source draft when an earlier list toggle finishes", async () => {
  const row = {
    id: "source-one",
    source: "person.synthetic",
    enabled: false,
    audiences: {},
    current: null,
    stale: false,
  };
  let reads = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.get("*/api/trips/trip-one/live-location", () => {
      reads += 1;
      return HttpResponse.json([row]);
    }),
    http.get("*/api/trips/trip-one/share-links", () => HttpResponse.json([])),
    http.put("*/api/trips/trip-one/live-location/source-one", async () => {
      await pending;
      return HttpResponse.json(row);
    }),
  );
  renderRoutesWithOwner(createRootRoute({ component: () => <LiveLocation tripId="trip-one" /> }), [
    "/",
  ]);
  fireEvent.click(await screen.findByRole("button", { name: m.live_title() }));
  fireEvent.click(await screen.findByRole("button", { name: m.live_start() }));
  fireEvent.click(screen.getByRole("button", { name: m.live_add() }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "person.draft" } });
  const readsBeforeCompletion = reads;
  finish();
  await waitFor(() => expect(reads).toBeGreaterThan(readsBeforeCompletion));
  await waitFor(() =>
    expect(screen.getByRole("dialog").querySelector('button[type="submit"]')).not.toBeDisabled(),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("person.draft");
});

it("shows deletion failure inside the confirmation dialog", async () => {
  server.use(
    http.get("*/api/trips/trip-one/live-location", () =>
      HttpResponse.json([
        {
          id: "source-one",
          source: "person.synthetic",
          enabled: false,
          audiences: {},
          current: null,
          stale: false,
        },
      ]),
    ),
    http.get("*/api/trips/trip-one/share-links", () => HttpResponse.json([])),
    http.delete(
      "*/api/trips/trip-one/live-location/source-one/tracks",
      () => new HttpResponse(null, { status: 500 }),
    ),
  );
  renderRoutesWithOwner(createRootRoute({ component: () => <LiveLocation tripId="trip-one" /> }), [
    "/",
  ]);
  fireEvent.click(await screen.findByRole("button", { name: m.live_title() }));
  fireEvent.click(await screen.findByRole("button", { name: m.live_delete_tracks() }));
  fireEvent.click(screen.getByRole("button", { name: m.owner_delete() }));
  await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(m.live_failed()));
});

it("keeps stop controls usable without the sharing overview", async () => {
  const row = {
    id: "source-one",
    source: "person.synthetic",
    enabled: true,
    audiences: {},
    delays: {},
    previews: {},
    current: null,
    stale: false,
  };
  let stopped = false;
  server.use(
    http.get("*/api/trips/trip-one/live-location", () => HttpResponse.json([row])),
    http.get("*/api/trips/trip-one/share-links", () => HttpResponse.json([])),
    http.put("*/api/trips/trip-one/live-location/source-one", async ({ request }) => {
      stopped = ((await request.json()) as { enabled: boolean }).enabled === false;
      return HttpResponse.json(row);
    }),
  );
  renderRoutesWithOwner(
    createRootRoute({ component: () => <SharingReview tripId="trip-one" overview={undefined} /> }),
    ["/"],
  );
  fireEvent.click(await screen.findByRole("button", { name: m.live_title() }));
  fireEvent.click(await screen.findByRole("button", { name: m.live_stop() }));
  await waitFor(() => expect(stopped).toBe(true));
});
