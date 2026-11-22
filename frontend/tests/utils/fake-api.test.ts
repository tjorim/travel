import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { fakeApi, resolveTexts } from "./fake-api";

it("reads a text in the content language of the record that carries it", () => {
  const collection = { content_language: "en", title_nl: "Reis", title_en: "Trip" };
  expect(resolveTexts(collection)).toMatchObject({ title: "Trip" });
  expect(resolveTexts({ ...collection, content_language: "nl" })).toMatchObject({ title: "Reis" });
  // Without a language of its own a record reads as Dutch, as the API's default does.
  expect(resolveTexts({ title_nl: null, title_en: "Trip" })).toMatchObject({ title: "Trip" });
});

it("resolves a collection's title in its content language when it is created or changed", async () => {
  const api = fakeApi().collection<Api.CollectionResponse>("/api/collections", []).install();
  const sent = (method: string, path: string, body: unknown) =>
    fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json());
  const created = await sent("POST", "/api/collections", {
    content_language: "en",
    label: "Family",
    title_nl: "Reis",
    title_en: "Trip",
  });
  expect(created.title).toBe("Trip");
  const changed = await sent("PATCH", `/api/collections/${created.id}`, { title_nl: "Reizen" });
  expect(changed).toMatchObject({ title_nl: "Reizen", title: "Trip" });
  expect(api.unexpected).toEqual([]);
});

it("keeps a title cleared in both languages cleared", async () => {
  const api = fakeApi()
    .collection<Api.CollectionResponse>("/api/collections", [
      {
        content_language: "nl",
        state: "draft",
        token: null,
        expires_at: null,
        rotations: 0,
        created_at: "2054-01-01T00:00:00Z",
        updated_at: "2054-01-01T00:00:00Z",
        activated_at: null,
        revoked_at: null,
        members: [],
        id: "c1",
        label: "Family",
        title: "Old",
        translation_freshness: {},
        title_nl: "Old",
        title_en: null,
      },
    ])
    .install();
  const response = await fetch("/api/collections/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title_nl: null, title_en: null }),
  });
  expect(await response.json()).toMatchObject({ title: null, title_nl: null, title_en: null });
  expect(api.unexpected).toEqual([]);
});
