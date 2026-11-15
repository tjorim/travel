// @vitest-environment happy-dom
import { act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { changeLocale, chosenLocale } from "./locale";

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => changeLocale("nl"));
  localStorage.clear();
});

it("remembers a language choice, and none the visitor did not make", () => {
  localStorage.clear();
  // The translation runtime writes the language it starts in here: that is no choice.
  localStorage.setItem("travel-locale", "en");
  expect(chosenLocale()).toBeNull();
  act(() => changeLocale("en"));
  expect(chosenLocale()).toBe("en");
});

it("keeps a choice that could not be written, for as long as the page lives", () => {
  act(() => changeLocale("nl"));
  expect(chosenLocale()).toBe("nl");
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: () => {
      throw new Error("denied");
    },
  });
  act(() => changeLocale("en"));
  // The stored choice is still Dutch, but the visitor has just chosen English.
  expect(chosenLocale()).toBe("en");
  vi.unstubAllGlobals();
  // Once a write works again the stored choice is the truth.
  act(() => changeLocale("nl"));
  expect(chosenLocale()).toBe("nl");
});
