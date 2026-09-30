// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { VisitorRoutes } from "./visitor-routes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => changeLocale("nl"));
});

it("retains visitor error descriptors and reevaluates an already-visible failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: "Private diagnostic",
            errors: [{ code: "database_unavailable", params: {}, path: [] }],
          }),
          { status: 503 },
        ),
    ),
  );
  render(<VisitorRoutes initialEntries={["/trips/example"]} />);
  expect(await screen.findByText("De database is tijdelijk niet beschikbaar.")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText("Database unavailable")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Private diagnostic");
});

it("keeps 403 and 404 unavailable states uniform even if a server supplies distinct codes", async () => {
  for (const status of [403, 404]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: "private reason",
              errors: [{ code: "unauthorized", params: {}, path: [] }],
            }),
            { status },
          ),
      ),
    );
    const view = render(<VisitorRoutes initialEntries={["/share/capability"]} />);
    expect(await screen.findByText("Deze reis is niet beschikbaar.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private reason");
    expect(document.body.textContent).not.toContain("verlopen");
    view.unmount();
  }
});
