// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { setLocale } from "./paraglide/runtime.js";
import { areaName, presetRecordName } from "./records";

it("names an unnamed area in the selected locale and keeps a given name as written", () => {
  try {
    setLocale("en", { reload: false });
    expect(areaName({ label: null })).toBe("Unnamed area");
    setLocale("nl", { reload: false });
    expect(areaName({ label: null })).toBe("Naamloos gebied");
    expect(areaName({ label: "Taipei" })).toBe("Taipei");
  } finally {
    setLocale("en", { reload: false });
  }
});

it("names a preset record by its label and, for a stay, its check-in day in the selected locale", () => {
  const stay = { kind: "stay", id: "s1", label: "Alpha Town", day: "2054-04-01" } as const;
  // The day is formatted, never shown as the raw ISO string, whichever locale is selected.
  expect(presetRecordName(stay, "Untitled")).toMatch(/^Alpha Town · 1 \p{L}+ 2054$/u);
  expect(
    presetRecordName(
      {
        day: null,
        kind: "visit",
        id: "v1",
        label: "Market",
      },
      "Untitled",
    ),
  ).toBe("Market");
  expect(
    presetRecordName(
      {
        day: null,
        kind: "visit",
        id: "v2",
        label: null,
      },
      "Untitled",
    ),
  ).toBe("Untitled");
});
