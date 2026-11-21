// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useInPlaceCreate, type CreateRequest } from "@/features/trips/records/create-request";
import { useFocusRequest } from "@/features/trips/records/record-focus";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const request = (origin: HTMLElement): CreateRequest => ({
  kind: "visit",
  prefill: {},
  token: 1,
  returnTo: origin,
});

it("returns to the new record's agenda row after saving a record it started", () => {
  const origin = document.createElement("button");
  const row = document.createElement("button");
  row.dataset.agendaRecord = "visit:new-visit";
  document.body.append(origin, row);
  const { result } = renderHook(() =>
    useInPlaceCreate("visit", request(origin), undefined, vi.fn()),
  );
  act(() => result.current.saved("new-visit"));
  expect(result.current.returnFocus()).toBe(row);
});

it("returns to the control that asked when nothing was saved", () => {
  const origin = document.createElement("button");
  document.body.append(origin);
  const { result } = renderHook(() =>
    useInPlaceCreate("visit", request(origin), undefined, vi.fn()),
  );
  expect(result.current.returnFocus()).toBe(origin);
});

it("opens a record for the workspace's request and for the list's own, each as a new request", () => {
  const first = { id: "a", token: 1 };
  const { result, rerender } = renderHook(({ request }) => useFocusRequest(request), {
    initialProps: { request: first as { id: string; token: number } | null },
  });
  expect(result.current.focusId).toBe(first);

  act(() => result.current.open("b"));
  expect(result.current.focusId).toMatchObject({ id: "b" });
  const own = result.current.focusId;
  act(() => result.current.open("b"));
  expect(result.current.focusId).not.toBe(own);

  const next = { id: "c", token: 2 };
  rerender({ request: next });
  expect(result.current.focusId).toBe(next);
});
