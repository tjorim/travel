import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { useForm } from "@tanstack/react-form";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it } from "vitest";

import { AuthProvider } from "@/app/providers/auth-context";
import { ContentLanguageProvider, type ContentLanguage } from "@/i18n/content-language";
import { server } from "@/mocks/server";
import { testToken } from "../../utils/query-test-utils";
import { LocalizedField } from "@/components/forms/LocalizedField";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

type Values = {
  titleNl: string;
  titleEn: string;
  titleReviewed?: ContentLanguage | null;
  bodyNl: string;
  bodyEn: string;
};
let latest: { reset: (values: Values) => void; values: () => Values } | undefined;

function Editor({
  initial,
  language = "nl",
  required = false,
  staleLanguage,
}: {
  initial?: Partial<Values>;
  language?: ContentLanguage;
  required?: boolean;
  staleLanguage?: ContentLanguage;
}) {
  const defaults: Values = { titleNl: "", titleEn: "", bodyNl: "", bodyEn: "", ...initial };
  const form = useForm({ defaultValues: defaults });
  latest = { reset: (values) => form.reset(values), values: () => form.state.values };
  return (
    <ContentLanguageProvider language={language}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <LocalizedField
          form={form}
          name="title"
          label="Titel"
          required={required}
          requiredMessage={() => "Geef een titel."}
          freshness={
            staleLanguage && {
              nl_updated_at: "2026-11-22T10:00:00Z",
              en_updated_at: "2026-11-21T10:00:00Z",
              possibly_out_of_date: staleLanguage,
            }
          }
          maxLength={160}
        />
        <LocalizedField form={form} name="body" kind="markdown" label="Tekst" rows={3} />
        <button type="submit">Opslaan</button>
      </form>
    </ContentLanguageProvider>
  );
}

function withOwner(ui: React.ReactElement) {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken(), expiresAt: Date.now() + 60_000 }),
  );
  return render(<AuthProvider>{ui}</AuthProvider>);
}

/** Answers the translation endpoint with each reply in turn (a 500 once they run out) and records the bodies sent. */
function answers(...replies: Response[]) {
  const sent: unknown[] = [];
  server.use(
    http.post("/api/translation/drafts", async ({ request }) => {
      sent.push(await request.json());
      return (
        replies.shift() ??
        HttpResponse.json(
          /* Fixture exception: Error/control response: exercises failure handling rather than a successful API record. */ {},
          { status: 500 },
        )
      );
    }),
  );
  return sent;
}

const titleInput = () => screen.getByLabelText("Titel") as HTMLInputElement;
const languages = (label: string) =>
  within(screen.getByRole("radiogroup", { name: `Taal van ${label}` }));
const choice = (name: RegExp, label = "Titel") => languages(label).getByRole("radio", { name });

it("shows the content language first and says which version is still empty", () => {
  render(<Editor initial={{ titleNl: "Rondreis Taiwan" }} />);
  const radios = languages("Titel").getAllByRole("radio");
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "Nederlands (hoofdtaal)",
    "Engels (leeg)",
  ]);
  expect(titleInput().value).toBe("Rondreis Taiwan");
  expect(titleInput().lang).toBe("nl");
  cleanup();

  render(<Editor language="en" initial={{ titleNl: "Rondreis Taiwan" }} />);
  expect(
    languages("Titel")
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-label")),
  ).toEqual(["Engels (hoofdtaal, leeg)", "Nederlands"]);
  expect(titleInput().lang).toBe("en");
});

it("edits each language on its own and marks the field language for assistive technology", () => {
  render(<Editor initial={{ titleNl: "Rondreis Taiwan", titleEn: "Taiwan tour" }} />);
  fireEvent.click(choice(/^Engels/));
  expect(titleInput().value).toBe("Taiwan tour");
  expect(titleInput().lang).toBe("en");
  fireEvent.change(titleInput(), { target: { value: "Taiwan round trip" } });
  fireEvent.click(choice(/^Nederlands/));
  expect(titleInput().value).toBe("Rondreis Taiwan");
  expect(latest?.values()).toMatchObject({
    titleNl: "Rondreis Taiwan",
    titleEn: "Taiwan round trip",
  });
});

it("allows clearing one language but not the last of a required text", async () => {
  render(<Editor required initial={{ titleNl: "Rondreis", titleEn: "Tour" }} />);
  fireEvent.change(titleInput(), { target: { value: "" } });
  expect(screen.queryByText("Geef een titel.")).toBeNull();
  expect(latest?.values()).toMatchObject({ titleNl: "", titleEn: "Tour" });
  fireEvent.click(choice(/^Engels/));
  fireEvent.change(titleInput(), { target: { value: "" } });
  // Both are empty now: the message shows whichever language is on screen.
  expect(await screen.findByText("Geef een titel.")).toBeTruthy();
  fireEvent.click(choice(/^Nederlands/));
  expect(screen.getByText("Geef een titel.")).toBeTruthy();
  fireEvent.change(titleInput(), { target: { value: "Rondreis" } });
  await waitFor(() => expect(screen.queryByText("Geef een titel.")).toBeNull());
});

it("fills the empty language with a draft that stays marked as unreviewed until saved", async () => {
  const sent = answers(
    HttpResponse.json<Api.TranslationDraftResponse>({
      machine_translated: true,
      text: "We arrived late.",
      source: "nl",
      target: "en",
    }),
  );
  withOwner(<Editor initial={{ bodyNl: "Wij kwamen laat aan." }} />);
  const body = () => screen.getByLabelText("Tekst") as HTMLTextAreaElement;
  // The Dutch text is there; no action for the language it is written in.
  expect(screen.queryByRole("button", { name: /^Concept vanuit/ })).toBeNull();
  fireEvent.click(choice(/^Engels/, "Tekst"));
  expect(body().value).toBe("");
  expect(screen.queryByRole("button", { name: "Concept vanuit het Engels" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Concept vanuit het Nederlands" }));
  await waitFor(() => expect(body().value).toBe("We arrived late."));
  expect(sent).toEqual([{ text: "Wij kwamen laat aan.", source: "nl", target: "en" }]);
  // The Dutch text is untouched, the draft is marked and nothing was appended anywhere.
  expect(latest?.values()).toMatchObject({
    bodyNl: "Wij kwamen laat aan.",
    bodyEn: "We arrived late.",
  });
  expect(screen.getByText("Automatisch vertaald concept, nog niet gecontroleerd")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Concept vanuit/ })).toBeNull();

  // Editing keeps the marker; saving the record (the form is clean again) removes it.
  fireEvent.change(body(), { target: { value: "We arrived late in the evening." } });
  expect(screen.getByText("Automatisch vertaald concept, nog niet gecontroleerd")).toBeTruthy();
  act(() => latest?.reset({ ...latest!.values() }));
  await waitFor(() =>
    expect(screen.queryByText("Automatisch vertaald concept, nog niet gecontroleerd")).toBeNull(),
  );
  expect(body().value).toBe("We arrived late in the evening.");
});

it("can discard a draft, reports a failure and retries, and leaves the other text alone", async () => {
  answers(
    HttpResponse.json<Api.TranslationDraftResponse>({
      machine_translated: true,
      text: "Hello",
      source: "nl",
      target: "en",
    }),
    HttpResponse.json(
      /* Fixture exception: Error/control response: exercises failure handling rather than a successful API record. */
      {
        detail: "x",
        errors: [{ code: "translation_service_is_unavailable", params: {}, path: [] }],
      },
      { status: 503 },
    ),
    HttpResponse.json<Api.TranslationDraftResponse>({
      machine_translated: true,
      text: "Hello again",
      source: "nl",
      target: "en",
    }),
  );
  withOwner(<Editor initial={{ titleNl: "Hallo" }} />);
  fireEvent.click(choice(/^Engels/));
  fireEvent.click(screen.getByRole("button", { name: "Concept vanuit het Nederlands" }));
  await waitFor(() => expect(titleInput().value).toBe("Hello"));
  fireEvent.click(screen.getByRole("button", { name: "Concept verwerpen" }));
  expect(titleInput().value).toBe("");
  expect(screen.queryByText("Automatisch vertaald concept, nog niet gecontroleerd")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Concept vanuit het Nederlands" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "vertaalservice is niet beschikbaar",
  );
  expect(titleInput().value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
  await waitFor(() => expect(titleInput().value).toBe("Hello again"));
  expect(latest?.values().titleNl).toBe("Hallo");
});

it("shows progress, can be cancelled, and is only offered while the other language has text", async () => {
  let signal: AbortSignal | undefined;
  server.use(
    http.post("/api/translation/drafts", ({ request }) => {
      signal = request.signal;
      // Never answers: the translation stays in progress until the owner cancels it.
      return new Promise<Response>(() => undefined);
    }),
  );
  withOwner(<Editor initial={{ titleEn: "Hello" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Concept vanuit het Engels" }));
  expect((await screen.findByRole("status")).textContent).toContain("Vertalen");
  fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
  expect(screen.queryByRole("status")).toBeNull();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  cleanup();

  render(<Editor />);
  expect(screen.queryByRole("button", { name: /^Concept vanuit/ })).toBeNull();
});

it("says which language visitors fall back to while a version is empty", () => {
  render(<Editor initial={{ titleNl: "Hallo" }} />);
  fireEvent.click(choice(/^Engels/));
  expect(
    screen.getByText(
      "Zonder tekst in het Engels zien bezoekers die Engels lezen de tekst in het Nederlands.",
    ),
  ).toBeTruthy();
});

it("queues a review for the flagged language without editing either text", () => {
  render(<Editor initial={{ titleNl: "Reis", titleEn: "Trip" }} staleLanguage="en" />);

  fireEvent.click(choice(/Engels \(mogelijk verouderd\)/));
  fireEvent.click(screen.getByRole("button", { name: "Nog steeds correct" }));
  expect(latest?.values()).toMatchObject({ titleNl: "Reis", titleEn: "Trip", titleReviewed: "en" });
  expect(screen.getByRole("status").textContent).toContain("zodra je opslaat");

  fireEvent.click(screen.getByRole("button", { name: "Bevestiging ongedaan maken" }));
  expect(latest?.values().titleReviewed).toBeNull();
  expect(choice(/Engels \(mogelijk verouderd\)/)).toBeTruthy();
});
