// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useCreateRequest, useInPlaceCreate } from "./create-request";
import { useFocusRequest } from "./record-focus";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it("starts an empty record from the block's own control and drops that request once handled", () => {
  const external = vi.fn();
  const button = document.createElement("button");
  document.body.append(button);
  const { result } = renderHook(() => useCreateRequest("visit", null, external));
  expect(result.current.createRequest).toBeNull();

  act(() => result.current.start(button));
  expect(result.current.createRequest).toMatchObject({
    kind: "visit",
    prefill: {},
    returnTo: button,
    keepFocus: true,
  });

  act(() => result.current.onCreateHandled());
  expect(result.current.createRequest).toBeNull();
  expect(external).not.toHaveBeenCalled();
});

it("passes the workspace's request through and reports it handled to the workspace", () => {
  const external = vi.fn();
  const request = { kind: "stay" as const, prefill: { day: "2054-11-12" }, token: 3 };
  const { result } = renderHook(() => useCreateRequest("stay", request, external));
  expect(result.current.createRequest).toBe(request);
  act(() => result.current.onCreateHandled());
  expect(external).toHaveBeenCalledTimes(1);
});

it("gives each of the block's own requests a token that differs from the last and from the workspace's", () => {
  const { result } = renderHook(() => useCreateRequest("route", null, undefined));
  act(() => result.current.start(null));
  const first = result.current.createRequest?.token;
  act(() => result.current.onCreateHandled());
  act(() => result.current.start(null));
  const second = result.current.createRequest?.token;
  expect(first).toBeLessThan(0);
  expect(second).toBeLessThan(0);
  expect(second).not.toBe(first);
});

it("returns to the control that asked after saving a record it started, not to the agenda row", () => {
  const origin = document.createElement("button");
  const row = document.createElement("button");
  row.dataset.agendaRecord = "visit:new-visit";
  document.body.append(origin, row);
  const { result } = renderHook(() => {
    const own = useCreateRequest("visit", null, undefined);
    return {
      own,
      inPlace: useInPlaceCreate("visit", own.createRequest, own.onCreateHandled, vi.fn()),
    };
  });
  act(() => result.current.own.start(origin));
  act(() => result.current.inPlace.saved("new-visit"));
  expect(result.current.inPlace.returnFocus()).toBe(origin);
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
