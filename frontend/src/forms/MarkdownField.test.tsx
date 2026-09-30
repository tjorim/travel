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
  expect((await screen.findByRole("alert")).textContent).toBe("Dit kon niet worden uitgevoerd. Probeer opnieuw.");
});
