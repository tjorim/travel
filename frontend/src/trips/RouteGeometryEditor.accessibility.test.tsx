// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { changeLocale, LocaleBoundary } from "../locale";
import { m } from "../paraglide/messages.js";
import { RouteGeometryEditor } from "./RouteGeometryEditor";

afterEach(() => {
  cleanup();
  changeLocale("nl");
});

for (const locale of ["nl", "en"] as const) {
  for (const mode of ["edit", "preview"] as const) {
    it(`names the unavailable ${mode} map region in ${locale}`, async () => {
      changeLocale(locale);
      render(
        <LocaleBoundary>
          <RouteGeometryEditor coordinates={[]} onChange={() => undefined} mode={mode} />
        </LocaleBoundary>,
      );
      const region = screen.getByRole("region", {
        name: mode === "edit" ? m.owner_map_editor_for_route() : m.owner_map_preview_of_route(),
      });
      await within(region).findByText(
        mode === "edit"
          ? m.owner_the_map_editor_could_not_be_loaded_you_can_still_paste_coordinates_as_js()
          : m.owner_the_route_preview_could_not_be_loaded(),
      );
      expect(region).not.toHaveAttribute("tabindex");
      expect(region.querySelectorAll("[aria-label]")).toHaveLength(0);
    });
  }
}
