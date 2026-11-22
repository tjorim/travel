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

/**
 * What the server does with authored text a client sent in both languages: the plain field name reads as the
 * content language's text, else the other language's (`app.content_language.resolve`).
 */
export function resolveTexts<T extends object>(row: T, language?: "nl" | "en"): T {
  const values = row as Record<string, unknown>;
  // A record that carries its own content language (a trip, a collection) is read in it.
  language ??= values.content_language === "en" ? "en" : "nl";
  const resolved = { ...values };
  for (const key of Object.keys(values)) {
    if (!key.endsWith("_nl")) continue;
    const field = key.slice(0, -3);
    if (!(`${field}_en` in values)) continue;
    const texts = { nl: values[key] || null, en: values[`${field}_en`] || null };
    resolved[field] = texts[language] ?? texts[language === "nl" ? "en" : "nl"] ?? null;
  }
  return resolved as T;
}

/**
 * A test record written with plain texts (`title: "Night market"`) as the API sends it: each plain text with no
 * language of its own is that language's Dutch text, so a fixture needs only the plain name.
 */
export function localized<T extends object>(record: T): T {
  const values = { ...(record as Record<string, unknown>) };
  for (const field of ["title", "summary", "body", "label", "caption", "alt_text"]) {
    if (typeof values[field] === "string" && !values[`${field}_nl`] && !values[`${field}_en`])
      values[`${field}_nl`] = values[field];
  }
  return values as T;
}

// Type erasure is confined to this storage dispatcher. Each collection, value, handler and pushed
// row must choose a wire type at registration; negative compile checks keep inference disabled.
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
  collection<T extends Row = never>(
    path: string,
    rows: NoInfer<T>[],
    options: {
      create?: (body: Body, count: number) => NoInfer<T>;
      update?: (row: NoInfer<T>, body: Body) => NoInfer<T>;
    } = {},
  ): this {
    this.collections.set(path, {
      rows: rows.slice(),
      create: options.create,
      // The map erases each collection's type; only rows registered as T are handed back to this callback.
      update: options.update ? (row, body) => options.update!(row as T, body) : undefined,
    });
    return this;
  }

  /** Registers an empty collection at each path no test has registered: a screen reads more than its test is about. */
  ensure(...paths: string[]): this {
    for (const path of paths) if (!this.collections.has(path)) this.collection(path, []);
    return this;
  }

  /** Registers a read-only value. */
  value<T = never>(path: string, value: NoInfer<T>): this {
    this.singles.set(path, value);
    return this;
  }

  /** Registers a custom handler; its return value is sent as JSON, `undefined` as 204. A later handler wins over an earlier one. */
  on<T = never>(
    method: string,
    pattern: RegExp,
    handler: (body: unknown, match: RegExpExecArray) => NoInfer<T> | undefined,
  ): this {
    this.handlers.unshift({ method, pattern, handler });
    return this;
  }

  /** Adds a row to a registered collection, as a custom handler does after an upload. */
  push<T extends Row = never>(path: string, row: NoInfer<T>): T {
    const target = this.collections.get(path);
    if (!target) throw new Error(`no collection at ${path}`);
    target.rows = [...target.rows, row];
    return row;
  }

  rows<T extends Row = Row>(path: string): T[] {
    return (this.collections.get(path)?.rows ?? []) as T[];
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

  /** Answers every request of the current test through the MSW server. */
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
          ? resolveTexts(localized(own.create(body as Body, own.rows.length)))
          : resolveTexts({ id: `new-${own.rows.length}`, ...(body as Body) });
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
        // A texts sent as `null` are cleared: only a record a test wrote with plain texts is completed from them.
        const updated = resolveTexts(
          parent.update
            ? localized(parent.update(current, body as Body))
            : { ...current, ...(body as Body) },
        );
        parent.rows = parent.rows.map((row) => (row.id === id ? updated : row));
        return json(updated);
      }
      if (current && method === "DELETE") {
        parent.rows = parent.rows.filter((row) => row.id !== id);
        return new HttpResponse(null, { status: 204 });
      }
    }
    // Every trip screen with an alternatives panel reads these; a test that is not about them sees none.
    if (method === "GET" && /\/alternative-groups(\/suggestions)?$/.test(url)) return json([]);
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
