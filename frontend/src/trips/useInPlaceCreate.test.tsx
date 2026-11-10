// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useInPlaceCreate } from "./create-request";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function startFrom(button: HTMLElement) {
  return renderHook(() =>
    useInPlaceCreate(
      "stay",
      { kind: "stay", prefill: { day: "2054-11-12" }, token: 1, returnTo: button },
      vi.fn(),
      vi.fn(),
    ),
  );
}

it("returns to the current control when its DOM node was recreated under the same id", () => {
  const original = document.createElement("button");
  original.id = "add-to-day";
  document.body.append(original);
  const hook = startFrom(original);
  const replacement = document.createElement("button");
  replacement.id = original.id;
  original.replaceWith(replacement);
  expect(hook.result.current.returnFocus()).toBe(replacement);
});

it("keeps a connected origin and prefers a newly created record's row", () => {
  const origin = document.createElement("button");
  const row = document.createElement("button");
  row.dataset.agendaRecord = "stay:new-stay";
  document.body.append(origin, row);
  const hook = startFrom(origin);
  act(() => hook.result.current.saved("new-stay"));
  expect(hook.result.current.returnFocus()).toBe(row);
  const other = startFrom(origin);
  expect(other.result.current.returnFocus()).toBe(origin);
});

it("falls back to the agenda when the origin was removed without a replacement", () => {
  const agenda = document.createElement("section");
  agenda.id = "agenda";
  const toggle = document.createElement("button");
  agenda.append(toggle);
  const origin = document.createElement("button");
  origin.id = "removed-control";
  document.body.append(agenda, origin);
  const hook = startFrom(origin);
  origin.remove();
  expect(hook.result.current.returnFocus()).toBe(toggle);
});
