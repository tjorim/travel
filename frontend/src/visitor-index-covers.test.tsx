// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it } from "vitest";
import { server } from "./mocks/server";
import { VisitorRoutes } from "./visitor-routes";

afterEach(cleanup);
it.each(["/", "/trips"])(
  "shows scoped covers and text cards at %s, falling back after image failure",
  async (path) => {
    server.use(
      http.get("/api/public/trips", () =>
        HttpResponse.json([
          {
            slug: "coast",
            title: "Coast",
            summary: null,
            cover: {
              url: "/api/public/trips/coast/files/photo",
              width: 1200,
              height: 800,
              alt_text: "Fishing boats",
              focal_x: 30,
              focal_y: 70,
            },
          },
          { slug: "hills", title: "Hills", summary: "A quiet walk", cover: null },
        ]),
      ),
    );
    render(<VisitorRoutes initialEntries={[path]} />);
    const card = await screen.findByRole("link", { name: /Coast/ });
    const image = within(card).getByRole("img", { name: "Fishing boats" });
    expect(image.getAttribute("width")).toBe("1200");
    expect(image.getAttribute("style")).toContain("30% 70%");
    expect(image.parentElement?.className).toContain("aspect-video");
    expect(within(screen.getByRole("link", { name: /Hills/ })).queryByRole("img")).toBeNull();
    fireEvent.error(image);
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.getAttribute("href")).toBe("/trips/coast");
    expect(card.className).not.toContain("p-0");
  },
);
