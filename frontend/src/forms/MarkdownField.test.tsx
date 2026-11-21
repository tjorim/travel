import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { useForm } from "@tanstack/react-form";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it } from "vitest";

import { AuthProvider } from "@/app/providers/auth-context";
import { server } from "../mocks/server";
import { testToken } from "../query/test-utils";
import { MarkdownField, type MarkdownFormat } from "@/components/forms/MarkdownField";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function Editor({
  initial = "",
  format,
  lang,
}: {
  initial?: string;
  format?: MarkdownFormat;
  lang?: string;
}) {
  const form = useForm({ defaultValues: { notes: initial } });
  return (
    <form.Field name="notes">
      {(field) => <MarkdownField field={field} label="Notities" format={format} lang={lang} />}
    </form.Field>
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
  const sent: unknown[] = [];
  server.use(
    http.post("/api/markdown/render", async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json<Api.MarkdownRenderResponse>({
        html: "<table><tbody><tr><td><strong>Day 1</strong></td></tr></tbody></table>",
        text: "Day 1",
      });
    }),
  );
  withOwner(<Editor initial="| **Day 1** |" format="markdown" />);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  await waitFor(() =>
    expect(document.querySelector(".markdown strong")?.textContent).toBe("Day 1"),
  );
  expect(sent).toEqual([{ source: "| **Day 1** |", format: "markdown" }]);
  expect((screen.getByLabelText("Notities") as HTMLTextAreaElement).hidden).toBe(true);
  expect(screen.queryByRole("toolbar")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Schrijven" }));
  expect((screen.getByLabelText("Notities") as HTMLTextAreaElement).hidden).toBe(false);
});

it("says so when the preview cannot be rendered", async () => {
  server.use(
    http.post("/api/markdown/render", () =>
      HttpResponse.json(
        /* Fixture exception: Error/control response: exercises failure handling rather than a successful API record. */ {
          detail: "Nope",
        },
        { status: 422 },
      ),
    ),
  );
  withOwner(<Editor initial="x" format="contact" />);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Het voorbeeld kon niet worden geladen.",
  );
});

it("renders the preview in the language the field is written in", async () => {
  server.use(
    http.post("/api/markdown/render", () =>
      HttpResponse.json<Api.MarkdownRenderResponse>({
        html: "<p>It <strong>rained</strong></p>",
        text: "It rained",
      }),
    ),
  );
  const view = withOwner(<Editor initial="It **rained**" lang="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  await waitFor(() => expect(view.container.querySelector(".markdown")).toBeTruthy());
  expect(view.container.querySelector(".markdown")?.getAttribute("lang")).toBe("en");
});
