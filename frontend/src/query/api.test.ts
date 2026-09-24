import { afterEach, expect, it, vi } from "vitest";

import { ApiError, apiFailure, ownerRequest } from "./api";
import { shouldRetryQuery } from "./client";
import { ownerKeys } from "./keys";

afterEach(() => vi.unstubAllGlobals());

const session = { accessToken: "secret-token", expiresAt: Date.now() + 60_000 };
const reply = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));

it("sends the bearer token only in the request header", async () => {
  const fetcher = vi.fn(() => reply(200, [1]));
  vi.stubGlobal("fetch", fetcher);
  await expect(ownerRequest(session, "/api/trips", "fallback")).resolves.toEqual([1]);
  const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/api/trips");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
});

it("maps server detail, validation issues and 401 to owner-facing messages", async () => {
  expect((await apiFailure(new Response(JSON.stringify({ detail: "Reis bestaat niet." }), { status: 404 }), "fallback")).message).toBe("Reis bestaat niet.");
  const invalid = await apiFailure(new Response(JSON.stringify({ detail: [{ loc: ["body", "title"], msg: "Te lang." }, { loc: ["body"], msg: "Ongeldig." }] }), { status: 422 }), "fallback");
  expect(invalid.message).toBe("Te lang. Ongeldig.");
  expect(invalid.fieldErrors).toEqual({ title: "Te lang." });
  expect((await apiFailure(new Response("oops", { status: 500 }), "Mislukt.")).message).toBe("Mislukt.");
  const expired = await apiFailure(new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }), "fallback");
  expect(expired.unauthorized).toBe(true);
  expect(expired.message).toContain("verlopen");
});

it("reports an unreachable server as offline and leaves aborts alone", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
  const failure = await ownerRequest(session, "/api/trips", "fallback").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).offline).toBe(true);

  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))));
  await expect(ownerRequest(session, "/api/trips", "fallback", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});

it("retries transient failures but never a rejection or an offline read", () => {
  expect(shouldRetryQuery(0, new ApiError("x", 503))).toBe(true);
  expect(shouldRetryQuery(2, new ApiError("x", 503))).toBe(false);
  expect(shouldRetryQuery(0, new ApiError("x", 401))).toBe(false);
  expect(shouldRetryQuery(0, new ApiError("x", 404))).toBe(false);
  expect(shouldRetryQuery(0, new ApiError("x", 0))).toBe(false);
});

it("scopes every owner key by subject", () => {
  expect(ownerKeys.trips("a")).not.toEqual(ownerKeys.trips("b"));
  for (const key of [ownerKeys.trips("a"), ownerKeys.trip("a", "t"), ownerKeys.tripResource("a", "t", "stays")]) expect(key.slice(0, 2)).toEqual(["owner", "a"]);
  expect(ownerKeys.tripResource("a", "t", "stays").slice(0, ownerKeys.trip("a", "t").length)).toEqual(ownerKeys.trip("a", "t"));
});
