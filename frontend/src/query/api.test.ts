import { afterEach, expect, it, vi } from "vitest";

import { ApiError, apiFailure, ownerFile, ownerRequest, translateApiMessage } from "./api";
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
  expect(
    (await apiFailure(new Response(JSON.stringify({ detail: "Reis bestaat niet." }), { status: 404 }), "fallback"))
      .message,
  ).toBe("Reis bestaat niet.");
  const invalid = await apiFailure(
    new Response(
      JSON.stringify({
        detail: [
          { loc: ["body", "title"], msg: "Te lang." },
          { loc: ["body"], msg: "Ongeldig." },
        ],
      }),
      { status: 422 },
    ),
    "fallback",
  );
  expect(invalid.message).toBe("Te lang. Ongeldig.");
  expect(invalid.fieldErrors).toEqual({ title: "Te lang." });
  // A server error with no detail names what failed and that the server is at fault; a 4xx keeps the plain fallback.
  expect((await apiFailure(new Response("oops", { status: 500 }), "Mislukt.")).message).toBe(
    "Mislukt. De server reageert niet goed. Probeer het later opnieuw.",
  );
  expect((await apiFailure(new Response("oops", { status: 404 }), "Mislukt.")).message).toBe("Mislukt.");
  expect(
    (await apiFailure(new Response(JSON.stringify({ detail: "kapot" }), { status: 500 }), "Mislukt.")).message,
  ).toBe("kapot");
  const expired = await apiFailure(
    new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }),
    "fallback",
  );
  expect(expired.unauthorized).toBe(true);
  expect(expired.message).toContain("verlopen");
});

it("reports an unreachable server as offline and leaves aborts alone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
  const failure = await ownerRequest(session, "/api/trips", "fallback").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).offline).toBe(true);

  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))),
  );
  await expect(ownerRequest(session, "/api/trips", "fallback", { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("sends an upload as multipart without forcing a JSON content type", async () => {
  const fetcher = vi.fn(() => reply(201, { id: "doc" }));
  vi.stubGlobal("fetch", fetcher);
  const body = new FormData();
  body.set("title", "Polis");
  await ownerRequest(session, "/api/library/documents/uploads", "fallback", { method: "POST", body });
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.body).toBe(body);
  expect(init.headers).toEqual({ Authorization: "Bearer secret-token" });
});

it("downloads a protected file as a blob with the same auth, failure and abort handling", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(new Response("pdf bytes", { status: 200, headers: { "Content-Type": "application/pdf" } })),
  );
  vi.stubGlobal("fetch", fetcher);
  const blob = await ownerFile(session, "/api/library/documents/1/original", "fallback", { cache: "no-store" });
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
    message: "Bestand bestaat niet.",
    status: 404,
  });

  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))),
  );
  await expect(ownerFile(session, "/x", "fallback", { signal: controller.signal })).rejects.toMatchObject({
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
  for (const key of [ownerKeys.trips("a"), ownerKeys.trip("a", "t"), ownerKeys.tripResource("a", "t", "stays")])
    expect(key.slice(0, 2)).toEqual(["owner", "a"]);
  expect(ownerKeys.tripResource("a", "t", "stays").slice(0, ownerKeys.trip("a", "t").length)).toEqual(
    ownerKeys.trip("a", "t"),
  );
});

it("translates the API messages an owner can reach, and leaves Dutch text alone", () => {
  expect(translateApiMessage("Write the text for visitors before sharing this update")).toBe(
    "Schrijf eerst de tekst voor bezoekers voordat je deze reisupdate deelt.",
  );
  expect(translateApiMessage("Value error, Arrival must be after departure")).toBe(
    "De aankomst moet na het vertrek liggen.",
  );
  expect(translateApiMessage("Input should be less than or equal to 90")).toBe("Kies een waarde van 90 of minder.");
  expect(translateApiMessage("String should have at most 120 characters")).toBe("Gebruik maximaal 120 tekens.");
  expect(translateApiMessage("Deze locatie wordt nog gebruikt door: 1 verblijf.")).toBe(
    "Deze locatie wordt nog gebruikt door: 1 verblijf.",
  );
});

it("translates both the summary and the per-field messages of a validation failure", async () => {
  const response = new Response(
    JSON.stringify({ detail: [{ loc: ["body", "label"], msg: "Field required", type: "missing" }] }),
    { status: 422 },
  );
  const failure = await apiFailure(response, "mislukt");
  expect(failure.message).toBe("Dit veld is verplicht.");
  expect(failure.fieldErrors).toEqual({ label: "Dit veld is verplicht." });
});
