// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { server } from "../../mocks/server";
import { renderWithOwner, testToken } from "../../query/test-utils";
import type { ShareLink } from "../../api-types";
import { FeedControls } from "./FeedControls";
vi.mock("../../auth-context", () => ({
  useAuth: () => ({ session: { accessToken: testToken() } }),
}));
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});
it.each(["en", "nl"] as const)(
  "requires acknowledgement and preserves input/focus on locale changes (%s)",
  async (locale) => {
    act(() => changeLocale(locale));
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/trips/trip/share-links/link/feed/enable", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderWithOwner(
      <FeedControls
        tripId="trip"
        link={{ id: "link", state: "active", feed_token: null } as ShareLink}
      />,
    );
    expect(screen.getByText(m.feed_warning())).toBeTruthy();
    expect(screen.getByRole("button", { name: m.feed_enable() })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: m.feed_ack() }));
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "14");
    act(() => changeLocale(locale === "en" ? "nl" : "en"));
    expect(input).toHaveFocus();
    expect(input).toHaveValue(14);
    expect(screen.getByRole("checkbox", { name: m.feed_ack() })).toBeChecked();
    await user.click(screen.getByRole("button", { name: m.feed_enable() }));
    expect(bodies).toEqual([{ acknowledge_copies: true, expires_in_days: 14 }]);
  },
);
