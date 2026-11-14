// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw/http";
import { server } from "../../mocks/server";
import { changeLocale, LocaleBoundary } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { FinishedTrackImport } from "./FinishedTrackImport";

vi.mock("../../auth-context", () => ({
  useAuth: () => ({ session: { accessToken: "synthetic", expiresAt: Date.now() + 60000 } }),
}));
vi.mock("../RouteGeometryEditor", () => ({
  RouteGeometryEditor: () => <div>approximate draft</div>,
}));
afterEach(() => {
  cleanup();
  changeLocale("nl");
});

it("cancel ignores a late response and never applies a draft", async () => {
  let release: (() => void) | undefined;
  server.use(
    http.post("/api/trips/example/route-line-import", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return HttpResponse.json({
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      });
    }),
  );
  const change = vi.fn();
  render(
    <LocaleBoundary>
      <FinishedTrackImport tripId="example" onChange={change} />
    </LocaleBoundary>,
  );
  fireEvent.change(screen.getByLabelText(m.routes_track_file()), {
    target: { files: [new File(["<gpx/>"], "synthetic.gpx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: m.routes_track_preview() }));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: m.routes_track_cancel() }));
  await act(async () => {
    release?.();
  });
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByText("approximate draft")).toBeNull();
});

it("renders a translated fixed failure across locale changes without reflecting remote content", async () => {
  server.use(
    http.post("/api/trips/example/route-line-import", () =>
      HttpResponse.json({ detail: "PRIVATE-TRACK-MARKER" }, { status: 422 }),
    ),
  );
  const change = vi.fn();
  render(
    <LocaleBoundary>
      <FinishedTrackImport tripId="example" onChange={change} />
    </LocaleBoundary>,
  );
  fireEvent.change(screen.getByLabelText(m.routes_track_file()), {
    target: { files: [new File(["bad"], "synthetic.gpx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: m.routes_track_preview() }));
  await screen.findByText(m.routes_track_error());
  act(() => changeLocale("en"));
  expect(screen.getByRole("status")).toHaveTextContent(m.routes_track_error());
  expect(document.body.textContent).not.toContain("PRIVATE-TRACK-MARKER");
  expect(change).not.toHaveBeenCalled();
});
