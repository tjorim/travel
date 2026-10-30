// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { server } from "../mocks/server";
import { changeLocale } from "../locale";
import { AsyncSearchSelect, type SearchSelectOption } from "@/ui/SearchCombobox";

afterEach(() => {
  cleanup();
  changeLocale("nl");
});
async function loadOptions(query: string): Promise<SearchSelectOption[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("Private server error");
  return response.json();
}
it.each([
  ["nl", "Zoeken mislukt. Probeer het opnieuw.", "Opnieuw zoeken", "Geen resultaten"],
  ["en", "Search failed. Try again.", "Retry search", "No results"],
] as const)(
  "recovers in %s while preserving query, selection and editor",
  async (locale, failure, retry, empty) => {
    changeLocale(locale);
    const onChange = vi.fn();
    server.use(http.get("/api/search", () => HttpResponse.json({}, { status: 503 })));
    render(
      <form>
        <input aria-label="Notes" defaultValue="Unsaved notes" />
        <AsyncSearchSelect
          ariaLabel="Departure"
          value="saved"
          selectedOption={{ value: "saved", label: "Saved place" }}
          onChange={onChange}
          loadOptions={loadOptions}
          debounceMs={0}
        />
      </form>,
    );
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "Bay" } });
    expect(await screen.findByText(failure)).toHaveAttribute("role", "status");
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Bay");
    expect(onChange).not.toHaveBeenCalled();
    server.use(
      http.get("/api/search", ({ request }) => {
        expect(new URL(request.url).searchParams.get("q")).toBe("Bay");
        return HttpResponse.json([{ value: "bay", label: "Example Bay" }]);
      }),
    );
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: retry })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("option", { name: "Example Bay" })).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Bay");
    expect(screen.getByLabelText("Notes")).toHaveValue("Unsaved notes");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: "Example Bay" }));
    expect(onChange).toHaveBeenCalledWith("bay");
  },
);
it("announces loading separately from an empty result", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.get("/api/search", async () => {
      await pending;
      return HttpResponse.json([]);
    }),
  );
  render(
    <AsyncSearchSelect
      ariaLabel="Departure"
      value=""
      onChange={vi.fn()}
      loadOptions={loadOptions}
      debounceMs={0}
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "missing" } });
  expect(await screen.findByText("Zoeken…")).toHaveAttribute("role", "status");
  expect(screen.queryByText("Geen resultaten")).not.toBeInTheDocument();
  await act(async () => {
    finish();
  });
  expect(await screen.findByText("Geen resultaten")).toHaveAttribute("role", "status");
});
it.each(["resolve", "reject"])("ignores stale %s and clears old choices", async (outcome) => {
  let finish!: () => void;
  const load = vi.fn((query: string) =>
    query === "old"
      ? new Promise<SearchSelectOption[]>((resolve, reject) => {
          finish = () =>
            outcome === "resolve"
              ? resolve([{ value: "old", label: "Old result" }])
              : reject(new Error("old"));
        })
      : Promise.resolve([{ value: "new", label: "New result" }]),
  );
  render(
    <AsyncSearchSelect
      ariaLabel="Departure"
      value=""
      onChange={vi.fn()}
      loadOptions={load}
      debounceMs={0}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "old" } });
  await waitFor(() => expect(load).toHaveBeenCalledWith("old"));
  fireEvent.change(input, { target: { value: "new" } });
  await screen.findByRole("option", { name: "New result" });
  await act(async () => {
    finish();
  });
  expect(screen.getByRole("option", { name: "New result" })).toBeInTheDocument();
  expect(screen.queryByText("Old result")).not.toBeInTheDocument();
  expect(screen.queryByText("Zoeken mislukt. Probeer het opnieuw.")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "old" } });
  expect(screen.queryByRole("option", { name: "New result" })).not.toBeInTheDocument();
});
