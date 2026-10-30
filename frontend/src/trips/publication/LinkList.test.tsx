// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { changeLocale } from "../../locale";
import type { ShareLink } from "../../tracker-model";
import { LinkList } from "./LinkList";

const link = (id: string): ShareLink => ({
  id,
  series_id: "series",
  label: `Link ${id}`,
  state: "active",
  scope: {
    schema_version: "travel/share-scope@1",
    trip: { title: true, summary: true, dates: null },
    items: [],
  },
  token: null,
  expires_at: null,
  created_at: "2026-01-01T00:00:00Z",
  activated_at: null,
  revoked_at: null,
});
const show = (versions: number) =>
  render(
    <LinkList
      series={[
        {
          id: "series",
          current: link("current"),
          history: Array.from({ length: versions }, (_, index) => link(`old-${index}`)),
        },
      ]}
      hasLinks
      loading={false}
      editingLinkId={null}
      onSelect={() => undefined}
      onNew={() => undefined}
    />,
  );
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});

it.each([
  ["en", 1, "View 1 previous version"],
  ["en", 3, "View 3 previous versions"],
  ["nl", 1, "1 eerdere versie bekijken"],
  ["nl", 3, "3 eerdere versies bekijken"],
] as const)("labels the history toggle in %s for %i previous versions", (locale, count, name) => {
  act(() => changeLocale(locale));
  show(count);
  expect(screen.getByRole("button", { name })).toBeTruthy();
});
