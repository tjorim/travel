import { afterEach, expect, it, vi } from "vitest";

import { ApiError, apiFailure, ownerFile, ownerRequest } from "./api";
import { shouldRetryQuery } from "./client";
import { ownerKeys } from "./keys";

afterEach(() => vi.unstubAllGlobals());

const session = { accessToken: "secret-token", expiresAt: Date.now() + 60_000 };
const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

it("sends the bearer token only in the request header", async () => {
  const fetcher = vi.fn(() => reply(200, [1]));
  vi.stubGlobal("fetch", fetcher);
  await expect(ownerRequest(session, "/api/trips", "fallback")).resolves.toEqual([1]);
  const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/api/trips");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
});

it("localizes descriptors, keeps safe diagnostics separate and never renders unknown prose", async () => {
  const invalid = await apiFailure(
    new Response(
      JSON.stringify({
        detail: "diagnostic only",
        errors: [
          { code: "string_too_long", path: ["body", "title"], params: { max_length: 120 } },
          { code: "missing", path: ["body", "items", 0, "name"], params: {} },
        ],
      }),
      { status: 422 },
    ),
    "fallback",
  );
  expect(invalid.message).toBe("Gebruik maximaal 120 tekens. Dit veld is verplicht.");
  expect(invalid.fieldErrors).toEqual({
    title: "Gebruik maximaal 120 tekens.",
    "items.0.name": "Dit veld is verplicht.",
  });
  expect(invalid.diagnostic).toBe("diagnostic only");
  for (const body of [
    { detail: "remote prose" },
    { errors: [{ code: "future_code", path: [], params: {} }] },
    { errors: [null, {}] },
  ]) {
    const failure = await apiFailure(
      new Response(JSON.stringify(body), { status: 409 }),
      "fallback",
    );
    expect(failure.message).toBe("Dit kon niet worden uitgevoerd. Probeer opnieuw.");
  }
  expect((await apiFailure(new Response("oops", { status: 500 }), "fallback")).message).toContain(
    "server",
  );
  expect((await apiFailure(new Response("oops", { status: 404 }), "fallback")).message).toBe(
    "Dit kon niet worden uitgevoerd. Probeer opnieuw.",
  );
  const expired = await apiFailure(new Response("oops", { status: 401 }), "fallback");
  expect(expired.unauthorized).toBe(true);
  expect(expired.message).toContain("verlopen");
});

it("reports an unreachable server as offline and leaves aborts alone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
  const failure = await ownerRequest(session, "/api/trips", "fallback").catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).offline).toBe(true);

  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))),
  );
  await expect(
    ownerRequest(session, "/api/trips", "fallback", { signal: controller.signal }),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("sends an upload as multipart without forcing a JSON content type", async () => {
  const fetcher = vi.fn(() => reply(201, { id: "doc" }));
  vi.stubGlobal("fetch", fetcher);
  const body = new FormData();
  body.set("title", "Polis");
  await ownerRequest(session, "/api/library/documents/uploads", "fallback", {
    method: "POST",
    body,
  });
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.body).toBe(body);
  expect(init.headers).toEqual({ Authorization: "Bearer secret-token" });
});

it("downloads a protected file as a blob with the same auth, failure and abort handling", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response("pdf bytes", { status: 200, headers: { "Content-Type": "application/pdf" } }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const blob = await ownerFile(session, "/api/library/documents/1/original", "fallback", {
    cache: "no-store",
  });
  expect(blob.type).toBe("application/pdf");
  expect(await blob.text()).toBe("pdf bytes");
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.headers).toEqual({ Authorization: "Bearer secret-token" });
  expect(init.cache).toBe("no-store");

  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(404, { detail: "Bestand bestaat niet." })),
  );
  await expect(ownerFile(session, "/x", "fallback")).rejects.toMatchObject({
    message: "Dit kon niet worden uitgevoerd. Probeer opnieuw.",
    status: 404,
  });

  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))),
  );
  await expect(
    ownerFile(session, "/x", "fallback", { signal: controller.signal }),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
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
  for (const key of [
    ownerKeys.trips("a"),
    ownerKeys.trip("a", "t"),
    ownerKeys.tripResource("a", "t", "stays"),
  ])
    expect(key.slice(0, 2)).toEqual(["owner", "a"]);
  expect(
    ownerKeys.tripResource("a", "t", "stays").slice(0, ownerKeys.trip("a", "t").length),
  ).toEqual(ownerKeys.trip("a", "t"));
});

it("does not render remote fragments from a malformed successful JSON response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("secret-token malformed JSON", { status: 200 })),
  );
  const failure = await ownerRequest(session, "/api/trips", "fallback").catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).status).toBe(200);
  expect((failure as ApiError).message).toContain("server");
  expect((failure as ApiError).message).not.toContain("secret-token");
  expect((failure as ApiError).diagnostic).toBe("Invalid API response");
});
