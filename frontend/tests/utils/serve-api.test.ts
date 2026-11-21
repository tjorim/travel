// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import { type ApiInit, serveApi } from "./serve-api";

afterEach(() => vi.unstubAllGlobals());

it.each(["GET", "POST"])("preserves a %s request for the next API responder", async (method) => {
  const fallback = vi.fn((_url: string, init: ApiInit) =>
    Response.json({ method: init.method, body: init.body ?? null }),
  );
  serveApi(fallback);
  const overlay = vi.fn(() => undefined);
  serveApi(overlay);

  const response = await fetch("http://localhost:3000/api/layered?test=1", {
    method,
    ...(method === "POST" ? { body: "payload" } : {}),
  });

  expect(await response.json()).toEqual({ method, body: method === "POST" ? "payload" : null });
  expect(overlay).toHaveBeenCalledOnce();
  expect(fallback).toHaveBeenCalledOnce();
  expect(fallback.mock.calls[0]?.[0]).toBe("/api/layered?test=1");
});
