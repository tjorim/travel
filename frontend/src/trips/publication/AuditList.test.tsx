// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale, formatDate } from "../../locale";
import { server } from "../../mocks/server";
import { renderWithOwner, testToken } from "../../query/test-utils";
import type { AuditEvent } from "../../tracker-model";
import { AuditList } from "./AuditList";

vi.mock("../../auth-context", () => ({
  useAuth: () => ({ session: { accessToken: testToken() } }),
}));
afterEach(() => {
  cleanup();
  changeLocale("nl");
});
const event = (kind: AuditEvent["kind"], details: AuditEvent["details"] = {}): AuditEvent => ({
  id: kind,
  kind,
  target_type: kind === "record.visibility_change" ? "record" : "share_link",
  target_id: "secret-target-id",
  occurred_at: "2026-10-30T10:00:00Z",
  details,
});
const events = [
  event("public_projection.scope_change", {
    scope_version_before: "secret-before",
    scope_version_after: "secret-after",
  }),
  event("share_link.scope_change"),
  event("record.visibility_change", {
    record_kind: "travel_update",
    from: "private",
    to: "everyone",
    newly_reached: ["public", "link:secret-link-a", "link:secret-link-b"],
    no_longer_reached: ["link:secret-link-c"],
  }),
  event("share_link.revoke"),
  event("location.update", {
    changes: [
      { field: "label", audiences: ["public", "link:secret-link-a"] },
      { field: "area_id", audiences: ["link:secret-link-a"] },
    ],
  }),
];
it.each(["en", "nl"] as const)(
  "renders private audit details in %s and updates on locale changes",
  async (locale) => {
    changeLocale(locale);
    server.use(http.get("/api/trips/trip/audit-events", () => HttpResponse.json(events)));
    const { container } = renderWithOwner(<AuditList tripId="trip" />);
    expect(
      await screen.findByText(
        locale === "en"
          ? "Public page selection changed."
          : "Selectie van de openbare pagina gewijzigd.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en" ? "Share link selection changed." : "Selectie van een deellink gewijzigd.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en"
          ? "Travel update: visibility changed from private to everyone."
          : "Reisupdate: zichtbaarheid gewijzigd van privé naar iedereen.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en"
          ? "Newly visible on the public page: 1; newly reached share links: 2."
          : "Nieuw zichtbaar op de openbare pagina: 1; nieuw bereikte deellinks: 2.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en"
          ? "No longer visible on the public page: 0; share links no longer reached: 1."
          : "Niet meer zichtbaar op de openbare pagina: 0; niet meer bereikte deellinks: 1.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en"
          ? "Place: details visitors read were changed (Public name, Area)."
          : "Plaats: gegevens die bezoekers lezen zijn gewijzigd (Publieke naam, Gebied).",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        locale === "en"
          ? "Read on the public page: 1; share links: 1."
          : "Gelezen op de openbare pagina: 1; deellinks: 1.",
      ),
    ).toBeVisible();
    expect(container.textContent).not.toContain("secret-");
    expect(container.querySelector("time")).toHaveTextContent(
      formatDate(new Date(events[0].occurred_at), { dateStyle: "medium", timeStyle: "short" }),
    );
    act(() => changeLocale(locale === "en" ? "nl" : "en"));
    expect(
      screen.getByText(
        locale === "en"
          ? "Selectie van de openbare pagina gewijzigd."
          : "Public page selection changed.",
      ),
    ).toBeVisible();
  },
);
it("shows an empty history", async () => {
  server.use(http.get("/api/trips/trip/audit-events", () => HttpResponse.json([])));
  renderWithOwner(<AuditList tripId="trip" />);
  expect(await screen.findByText("Er zijn nog geen deelwijzigingen vastgelegd.")).toBeVisible();
});
it("uses a translated fallback without server prose", async () => {
  server.use(
    http.get("/api/trips/trip/audit-events", () =>
      HttpResponse.json({ detail: "secret-server-text" }, { status: 500 }),
    ),
  );
  renderWithOwner(<AuditList tripId="trip" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "De deelgeschiedenis kon niet worden geladen.",
  );
  expect(screen.queryByText("secret-server-text")).not.toBeInTheDocument();
});
