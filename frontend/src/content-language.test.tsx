// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import {
  AuthoredText,
  authoredLanguage,
  ContentLanguageProvider,
  pickText,
} from "./content-language";

afterEach(cleanup);

it("picks the preferred language's text, else the other's, as the API does", () => {
  expect(pickText({ nl: "Hallo", en: "Hello" }, "en")).toEqual({ text: "Hello", language: "en" });
  expect(pickText({ nl: "Hallo", en: null }, "en")).toEqual({ text: "Hallo", language: "nl" });
  expect(pickText({ nl: "", en: "Hello" }, "nl")).toEqual({ text: "Hello", language: "en" });
  expect(pickText({ nl: null, en: null }, "nl")).toBeNull();
});

it("names the language an owner's text is shown in, and none for a record without it", () => {
  expect(authoredLanguage({ title_nl: "Hallo", title_en: "Hello" }, "title", "nl")).toBe("nl");
  expect(authoredLanguage({ title_nl: null, title_en: "Hello" }, "title", "nl")).toBe("en");
  expect(authoredLanguage({ title_nl: null, title_en: null }, "title", "nl")).toBeUndefined();
});

it("marks an owner's authored text with its language, following the trip it belongs to", () => {
  const visit = { title_nl: null, title_en: "Museum", summary_nl: null, summary_en: null };
  render(
    <ContentLanguageProvider language="nl">
      <AuthoredText as="h3" record={visit} field="title">
        Museum
      </AuthoredText>
      <AuthoredText as="p" record={visit} field="summary">
        Taipei
      </AuthoredText>
      <AuthoredText as="strong" record={{ ...visit, content_language: "en" }} field="title">
        Own language
      </AuthoredText>
    </ContentLanguageProvider>,
  );
  // The Dutch trip has only an English title for this visit, so that is what is shown, and marked.
  expect(screen.getByRole("heading", { name: "Museum" }).getAttribute("lang")).toBe("en");
  // A text the record lacks (a visit named after its place) is not that text: no `lang`.
  expect(screen.getByText("Taipei").hasAttribute("lang")).toBe(false);
  expect(screen.getByText("Own language").getAttribute("lang")).toBe("en");
});
