import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import indexHtml from "../index.html?raw";
import landingHtml from "../landing.html?raw";
import publicHtml from "../public.html?raw";
import shareHtml from "../share.html?raw";
import { LocaleBoundary, changeLocale, resolveLocale, useLocale, formatNumber } from "./locale";
import { m } from "./paraglide/messages.js";
import { getLocale } from "./paraglide/runtime.js";
import { RecordDialog } from "./RecordDialog";
import { dayjs } from "./dayjs";
import nl from "../messages/nl.json";
import en from "../messages/en.json";
import bootstrap from "../public/locale.js?raw";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => changeLocale("nl"));
});
describe("locale foundation", () => {
  it("validates storage and chooses the first supported regional browser language", () => {
    expect(resolveLocale("en", ["nl-BE"])).toBe("en");
    for (const value of [null, "fr", "en-GB", {}, ""])
      expect(resolveLocale(value, ["fr-FR", "en-GB", "nl-BE"])).toBe("en");
    expect(resolveLocale(null, ["nl-BE", "en"])).toBe("nl");
    expect(resolveLocale(null, ["fr"])).toBe("nl");
  });
  it("bootstraps every HTML entry before React, tolerating storage denial", () => {
    for (const html of [indexHtml, landingHtml, publicHtml, shareHtml]) {
      expect(html.indexOf("/locale.js")).toBeLessThan(html.indexOf('type="module"'));
      expect(html).toContain('lang="nl"');
    }
    for (const stored of ["en", "invalid", null]) {
      const root = { lang: "nl", dataset: {} };
      new Function("document", "navigator", "localStorage", bootstrap)(
        { documentElement: root },
        { languages: ["fr", "en-GB"] },
        { getItem: () => stored },
      );
      expect(root.lang).toBe("en");
    }
    const root = { lang: "nl", dataset: {} };
    new Function("document", "navigator", "localStorage", bootstrap)(
      { documentElement: root },
      { language: "nl-BE" },
      {
        getItem: () => {
          throw Error();
        },
      },
    );
    expect(root.lang).toBe("nl");
  });
  it("switches without remounting a dirty dialog, dropping uploads, focus, or changing the URL", () => {
    function Editor() {
      useLocale();
      const [text, setText] = useState("");
      return (
        <RecordDialog open title={m.settings()} dirty onDismiss={() => {}}>
          <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
          <input aria-label="upload" type="file" />
        </RecordDialog>
      );
    }
    const client = new QueryClient();
    client.setQueryData(["owner", "fixture"], { title: "Private trip" });
    const view = render(
      <QueryClientProvider client={client}>
        <LocaleBoundary>
          <Editor />
        </LocaleBoundary>
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText("draft") as HTMLInputElement;
    const upload = screen.getByLabelText("upload") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Mijn eigen tekst" } });
    const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(upload, { target: { files: [file] } });
    input.focus();
    const url = window.location.href;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error();
    });
    act(() => changeLocale("en"));
    expect(client.getQueryData(["owner", "fixture"])).toEqual({ title: "Private trip" });
    expect(getLocale()).toBe("en");
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Settings");
    expect(screen.getByLabelText("draft")).toBe(input);
    expect(input.value).toBe("Mijn eigen tekst");
    expect(upload.files?.[0]).toBe(file);
    expect(document.activeElement).toBe(input);
    expect(window.location.href).toBe(url);
    expect(document.documentElement.lang).toBe("en");
    view.unmount();
  });
  it("has matching keys and placeholders and evaluates whole plural messages in the current locale", () => {
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(nl) as (keyof typeof nl)[]) {
      const placeholders = (value: unknown) =>
        [...JSON.stringify(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(nl[key])).toEqual(placeholders(en[key]));
    }
    for (const locale of ["nl", "en"] as const) {
      act(() => changeLocale(locale));
      for (const count of [0, 1, 3])
        expect(m.saved_trip_count({ count })).toBe(
          locale === "en"
            ? `${count} saved ${count === 1 ? "trip" : "trips"}`
            : `${count} bewaarde ${count === 1 ? "reis" : "reizen"}`,
        );
      expect(m.disconnect_title({ provider: "GoPro Cloud" })).toContain("GoPro Cloud");
    }
  });
  it("changes display formatting while preserving date-only and timezone semantics and numeric values", () => {
    const iso = "2054-03-29";
    const timestamp = "2054-03-29T01:30:00Z";
    const values = () => [
      dayjs.utc(iso).format("YYYY-MM-DD"),
      dayjs(timestamp).tz("Europe/Brussels").format("YYYY-MM-DDTHH:mmZ"),
    ];
    const before = values();
    act(() => changeLocale("en"));
    expect(values()).toEqual(before);
    expect(dayjs.utc(iso).format("MMMM")).toBe("March");
    expect(formatNumber(1.5)).toBe("1.5");
    act(() => changeLocale("nl"));
    expect(dayjs.utc(iso).format("MMMM")).toBe("maart");
    expect(formatNumber(1.5)).toBe("1,5");
  });
});

it("evaluates every catalogue plural at zero, one and multiple with authored interpolation intact", () => {
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    const catalogue = locale === "nl" ? nl : en;
    for (const [key, message] of Object.entries(catalogue)) {
      if (!Array.isArray(message)) continue;
      for (const variant of message) {
        if (!variant.declarations.some((declaration) => declaration.includes(": plural"))) continue;
        for (const count of [0, 1, 4]) {
          const inputs = Object.fromEntries(
            variant.declarations
              .filter((item) => item.startsWith("input "))
              .map((item) => [item.slice(6), item === "input count" ? count : "Authored <é> {text}"]),
          );
          const renderMessage = m[key as keyof typeof m] as (inputs: Record<string, string | number>) => string;
          const selector = count === 1 ? "countPlural=one" : "countPlural=other";
          const pattern = variant.match[selector as keyof typeof variant.match];
          expect(renderMessage(inputs)).toBe(pattern.replace(/\{(\w+)\}/g, (_, input) => String(inputs[input])));
        }
      }
    }
  }
});

it("keeps install-time metadata and machine routing fixed across runtime switches", async () => {
  const manifest = (await import("../public/manifest.webmanifest?raw")).default;
  const before = JSON.parse(manifest);
  act(() => changeLocale("en"));
  expect(JSON.parse(manifest)).toEqual(before);
  expect(before).toMatchObject({ name: "Travel", short_name: "Travel", start_url: "/admin/", scope: "/admin/" });
  for (const html of [indexHtml, landingHtml, publicHtml, shareHtml]) {
    expect(html).toContain('lang="nl"');
    expect(html).toContain("/locale.js");
  }
});

// Checked by tsc in CI: generated declarations must reject incorrect message calls.
function messageTypeContract() {
  m.disconnect_title({ provider: "Authored" });
  // @ts-expect-error A required interpolation cannot be omitted.
  m.disconnect_title({});
  // @ts-expect-error Unknown interpolations are not part of the contract.
  m.disconnect_title({ provider: "Authored", extra: "value" });
  // @ts-expect-error Misspelled catalogue keys cannot compile.
  m.nonexistent_interface_message();
}
void messageTypeContract;
