// @vitest-environment jsdom
import { useForm } from "@tanstack/react-form";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth-context";
import { testToken } from "../query/test-utils";
import { MarkdownField, type MarkdownFormat } from "./MarkdownField";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function Editor({ initial = "", format }: { initial?: string; format?: MarkdownFormat }) {
  const form = useForm({ defaultValues: { notes: initial } });
  return (
    <form.Field name="notes">{(field) => <MarkdownField field={field} label="Notities" format={format} />}</form.Field>
  );
}

function withOwner(ui: React.ReactElement) {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken(), expiresAt: Date.now() + 60_000 }),
  );
  return render(<AuthProvider>{ui}</AuthProvider>);
}

it("applies a toolbar snippet to the selection", () => {
  render(<Editor initial="Night market" />);
  const textarea = screen.getByLabelText("Notities") as HTMLTextAreaElement;
  textarea.setSelectionRange(0, 5);
  fireEvent.click(screen.getByRole("button", { name: "Vet" }));
  expect(textarea.value).toBe("**Night** market");
  fireEvent.click(screen.getByRole("button", { name: "Takenlijst" }));
  expect(textarea.value).toBe("- [ ] **Night** market");
});

it("offers only bold, italic and link for a caption, and no toolbar for contact details", () => {
  const caption = render(<Editor format="inline" />);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Schrijven",
    "Voorbeeld",
    "B",
    "I",
    "Link",
  ]);
  caption.unmount();
  render(<Editor format="contact" />);
  expect(screen.queryByRole("toolbar")).toBeNull();
});

it("previews the server's rendering of the current text", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          html: "<table><tbody><tr><td><strong>Day 1</strong></td></tr></tbody></table>",
          text: "Day 1",
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  withOwner(<Editor initial="| **Day 1** |" format="markdown" />);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  await waitFor(() => expect(document.querySelector(".markdown strong")?.textContent).toBe("Day 1"));
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/markdown/render");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ source: "| **Day 1** |", format: "markdown" });
  expect((screen.getByLabelText("Notities") as HTMLTextAreaElement).hidden).toBe(true);
  expect(screen.queryByRole("toolbar")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Schrijven" }));
  expect((screen.getByLabelText("Notities") as HTMLTextAreaElement).hidden).toBe(false);
});

it("says so when the preview cannot be rendered", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ detail: "Nope" }), { status: 422 })),
  );
  withOwner(<Editor initial="x" format="contact" />);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Het voorbeeld kon niet worden geladen.");
});

function answers(...replies: Response[]) {
  const fetch = vi.fn(async () => replies.shift() ?? new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("offers an editable machine-translated draft that is only added on request", async () => {
  const fetch = answers(new Response(JSON.stringify({ text: "We arrived late.", source: "nl", target: "en" })));
  withOwner(<Editor initial="Wij kwamen laat aan." />);
  const textarea = screen.getByLabelText("Notities") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "Vertaal naar Engels" }));
  expect(await screen.findByText("Automatisch vertaald concept")).toBeTruthy();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/translation/drafts");
  expect(JSON.parse(String(init.body))).toEqual({ text: "Wij kwamen laat aan.", source: "nl", target: "en" });
  // Nothing changes until the owner adds the draft.
  expect(textarea.value).toBe("Wij kwamen laat aan.");

  const draft = screen.getByLabelText("Vertaalconcept voor Notities") as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "We arrived late in the evening." } });
  fireEvent.click(screen.getByRole("button", { name: "Onder de tekst toevoegen" }));
  expect(textarea.value).toBe("Wij kwamen laat aan.\n\nWe arrived late in the evening.");
  expect(screen.queryByText("Automatisch vertaald concept")).toBeNull();
});

it("can discard a draft and leaves the text untouched when translating fails", async () => {
  answers(
    new Response(JSON.stringify({ text: "Hello", source: "nl", target: "en" })),
    new Response(
      JSON.stringify({ detail: "x", errors: [{ code: "translation_service_is_unavailable", params: {}, path: [] }] }),
      {
        status: 503,
      },
    ),
    new Response(JSON.stringify({ text: "Hello again", source: "nl", target: "en" })),
  );
  withOwner(<Editor initial="Hallo" />);
  const textarea = screen.getByLabelText("Notities") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "Vertaal naar Engels" }));
  fireEvent.click(await screen.findByRole("button", { name: "Concept verwerpen" }));
  expect(screen.queryByText("Automatisch vertaald concept")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Vertaal naar Engels" }));
  expect((await screen.findByRole("alert")).textContent).toContain("vertaalservice is niet beschikbaar");
  expect(textarea.value).toBe("Hallo");
  fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
  expect(await screen.findByText("Automatisch vertaald concept")).toBeTruthy();
  expect(textarea.value).toBe("Hallo");
});

it("shows progress, can be cancelled, and is only offered for text in a long-form field", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  vi.stubGlobal("fetch", fetch);
  withOwner(<Editor initial="Hallo" />);
  fireEvent.click(screen.getByRole("button", { name: "Vertaal naar Nederlands" }));
  expect((await screen.findByRole("status")).textContent).toContain("Vertalen");
  fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal as AbortSignal).aborted).toBe(true);
  cleanup();

  render(<Editor initial="" />);
  expect((screen.getByRole("button", { name: "Vertaal naar Engels" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  render(<Editor initial="Hallo" format="inline" />);
  expect(screen.queryByRole("button", { name: "Vertaal naar Engels" })).toBeNull();
});
