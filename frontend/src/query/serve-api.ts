import { http, HttpResponse } from "msw/http";
import { vi } from "vitest";

import { server } from "../mocks/server";

/** What a responder sees of a request: the method, headers and the body as sent (a string, a `FormData` or nothing). */
export type ApiInit = RequestInit & { method: string; headers: Headers };

/**
 * Answers a path and query (`/api/trips?x=1`). Return `undefined` to leave the request to the next handler; a thrown
 * error fails the request like a dropped connection.
 */
export type ApiResponder = (
  url: string,
  init: ApiInit,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Serves the current test's API through the MSW server (see src/mocks/server.ts), for suites that route requests in
 * a hand-written function. The server drops the handler when the test ends; a later `serveApi` call wins over an
 * earlier one for the requests it answers.
 *
 * It returns a spy over `fetch`, recording every call exactly as the screen made it, for assertions on client-side
 * options (`cache`, `credentials`, `referrerPolicy`) that never reach the network.
 *
 * Uploads are the exception: jsdom's `FormData` and `File` cannot be serialised by Node's `fetch`, so a request whose
 * body is a `FormData` goes to the responder directly and the screen sees the same object it sent.
 */
export function serveApi(respond: ApiResponder) {
  server.use(
    http.all("*", async ({ request }) => {
      const location = new URL(request.url);
      try {
        return await respond(location.pathname + location.search, {
          method: request.method,
          headers: request.headers,
          // MSW reuses the resolver request when a handler falls through.
          // Read our own clone so the next responder can still consume its body.
          body: await readBody(request.clone()),
        });
      } catch {
        return HttpResponse.error();
      }
    }),
  );
  const network = globalThis.fetch;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof FormData === "undefined" || !(init?.body instanceof FormData))
      return network(input, init);
    const location = new URL(String(input), "http://localhost");
    const answer = await respond(location.pathname + location.search, {
      ...init,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
    });
    return answer ?? network(input, init);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

/** The body as the screen sent it: multipart becomes `FormData`, anything else stays the raw text. */
async function readBody(request: Request): Promise<string | FormData | undefined> {
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data"))
    return request.formData();
  const text = await request.text();
  return text || undefined;
}
