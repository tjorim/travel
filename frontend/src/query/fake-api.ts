import { HttpResponse } from "msw/http";

import { serveApi } from "./serve-api";

type Row = { id: string } & Record<string, unknown>;
type Body = Record<string, unknown>;
type Collection = {
  rows: Row[];
  create?: (body: Body, count: number) => Row;
  update?: (row: Row, body: Body) => Row;
};
type Handler = (body: unknown, match: RegExpExecArray) => unknown;

const json = (value: unknown, status = 200) => HttpResponse.json(value as never, { status });

/**
 * A stateful in-memory owner API for screen tests, served through the MSW test server (see src/mocks/server.ts).
 * Collections answer list, create, update and delete the way the real service does, so a test can edit
 * or delete a record and assert what the screen shows afterwards.
 */
export class FakeApi {
  /** Every request as "METHOD /path". */
  requests: string[] = [];
  /** Requests nothing was registered for; a test can assert it stays empty. */
  unexpected: string[] = [];
  /** Fails the next write (anything but GET) with this response. */
  failNext: { status: number; body: unknown } | null = null;
  private collections = new Map<string, Collection>();
  private singles = new Map<string, unknown>();
  private handlers: { method: string; pattern: RegExp; handler: Handler }[] = [];
  private bodies: { key: string; body: unknown }[] = [];
  private received: { key: string; headers: Headers }[] = [];

  /** Registers a collection at `path` (list and create) and `path/:id` (update and delete). */
  collection<T extends Row>(
    path: string,
    rows: T[],
    options: Pick<Collection, "create" | "update"> = {},
  ): this {
    this.collections.set(path, { rows: rows.slice(), ...options });
    return this;
  }

  /** Registers a read-only value. */
  value(path: string, value: unknown): this {
    this.singles.set(path, value);
    return this;
  }

  /** Registers a custom handler; its return value is sent as JSON, `undefined` as 204. A later handler wins over an earlier one. */
  on(method: string, pattern: RegExp, handler: Handler): this {
    this.handlers.unshift({ method, pattern, handler });
    return this;
  }

  /** Adds a row to a registered collection, as a custom handler does after an upload. */
  push<T extends Row>(path: string, row: T): T {
    const target = this.collections.get(path);
    if (!target) throw new Error(`no collection at ${path}`);
    target.rows = [...target.rows, row];
    return row;
  }

  rows(path: string): Row[] {
    return this.collections.get(path)?.rows ?? [];
  }

  /** The parsed JSON body (or `FormData`) of the last matching request. */
  lastBody<T = Body>(key: string): T | undefined {
    return this.bodies.filter((entry) => entry.key === key).at(-1)?.body as T | undefined;
  }

  /** The headers of the last request that matched `key` ("METHOD /path"). */
  lastHeaders(key: string): Headers | undefined {
    return this.received.filter((entry) => entry.key === key).at(-1)?.headers;
  }

  count(key: string): number {
    return this.requests.filter((request) => request === key).length;
  }

  /** Answers every request of the current test through the MSW server (see `serveApi` for uploads). */
  install(): this {
    serveApi((url, init) => this.respond(init.method, url, parseBody(init.body), init.headers));
    return this;
  }

  private respond(method: string, url: string, body: unknown, headers: Headers): Response {
    const key = `${method} ${url}`;
    this.requests.push(key);
    this.received.push({ key, headers });
    this.bodies.push({ key, body });
    if (method !== "GET" && this.failNext) {
      const failure = this.failNext;
      this.failNext = null;
      return json(failure.body, failure.status);
    }
    for (const { method: expected, pattern, handler } of this.handlers) {
      const match = expected === method ? pattern.exec(url) : null;
      if (!match) continue;
      const result = handler(body, match);
      return result === undefined ? new HttpResponse(null, { status: 204 }) : json(result);
    }
    if (method === "GET" && this.singles.has(url)) return json(this.singles.get(url));
    const own = this.collections.get(url);
    if (own) {
      if (method === "GET") return json(own.rows);
      if (method === "POST") {
        const created = own.create
          ? own.create(body as Body, own.rows.length)
          : { id: `new-${own.rows.length}`, ...(body as Body) };
        own.rows = [...own.rows, created];
        return json(created, 201);
      }
    }
    const slash = url.lastIndexOf("/");
    const parent = slash > 0 ? this.collections.get(url.slice(0, slash)) : undefined;
    if (parent) {
      const id = decodeURIComponent(url.slice(slash + 1));
      const current = parent.rows.find((row) => row.id === id);
      if (current && method === "GET") return json(current);
      if (current && method === "PATCH") {
        const updated = parent.update
          ? parent.update(current, body as Body)
          : { ...current, ...(body as Body) };
        parent.rows = parent.rows.map((row) => (row.id === id ? updated : row));
        return json(updated);
      }
      if (current && method === "DELETE") {
        parent.rows = parent.rows.filter((row) => row.id !== id);
        return new HttpResponse(null, { status: 204 });
      }
    }
    this.unexpected.push(key);
    return json({ detail: `unexpected request ${key}` }, 404);
  }
}

/** A JSON body is parsed (anything else is kept as sent), as the screens' own code would read it. */
function parseBody(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function fakeApi(): FakeApi {
  return new FakeApi().install();
}
