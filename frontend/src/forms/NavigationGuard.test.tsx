// @vitest-environment happy-dom
import { useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NavigationGuard } from "./NavigationGuard";
import { RecordDialog } from "../RecordDialog";
import { RecordForm, TextField } from "./fields";
import { useRecordForm } from "./useRecordForm";
import { changeLocale } from "../locale";

const submit = vi.fn<(values: { title: string }) => Promise<void>>();
const saved = vi.fn();
function Editor() {
  const [open, setOpen] = useState(true);
  const record = useRecordForm({
    defaultValues: { title: "Original" },
    submit,
    fallback: () => "Failed",
    onSuccess: () => {
      saved();
      setOpen(false);
    },
  });
  return (
    <RecordDialog
      open={open}
      dirty={record.dirty}
      title="Record"
      onDismiss={() => {
        record.load({ title: "Original" });
        setOpen(false);
      }}
    >
      <RecordForm record={record} submitLabel="Save" pendingLabel="Saving">
        <record.form.Field name="title">
          {(field) => <TextField field={field} label="Title" />}
        </record.form.Field>
      </RecordForm>
    </RecordDialog>
  );
}
function setup() {
  const root = createRootRoute({
    component: () => (
      <NavigationGuard>
        <Outlet />
      </NavigationGuard>
    ),
  });
  const editor = createRoute({ getParentRoute: () => root, path: "/editor", component: Editor });
  const other = createRoute({
    getParentRoute: () => root,
    path: "/other",
    component: () => <p>Other page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor, other]),
    history: createMemoryHistory({ initialEntries: ["/other", "/editor"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  act(() => changeLocale("nl"));
});

it("keeps the exact draft after navigation is cancelled, and discards once", async () => {
  const router = setup();
  const input = await screen.findByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value: "Authored draft" } });
  input.focus();
  act(() => {
    void router.navigate({ to: "/other" });
  });
  const prompt = await screen.findByRole("alertdialog");
  fireEvent.click(within(prompt).getByRole("button", { name: "Verder bewerken" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(input).toHaveValue("Authored draft");
  await waitFor(() => expect(input).toHaveFocus());
  act(() => {
    void router.navigate({ to: "/other" });
  });
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Wijzigingen verwerpen",
    }),
  );
  expect(await screen.findByText("Other page")).toBeTruthy();
  act(() => {
    void router.navigate({ to: "/editor" });
  });
  expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Original");
});

for (const locale of ["nl", "en"] as const) {
  for (const fail of [false, true]) {
    it(`locks pending edits and navigation for ${locale}, ${fail ? "failure" : "success"}`, async () => {
      act(() => changeLocale(locale));
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      submit.mockImplementation(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const router = setup();
      const input = await screen.findByRole("textbox", { name: "Title" });
      const user = userEvent.setup();
      await user.clear(input);
      await user.type(input, "Submitted A");
      if (locale === "nl") await user.keyboard("{Enter}");
      else await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(input).toBeDisabled();
      await user.type(input, "Lost B");
      expect(input).toHaveValue("Submitted A");
      expect(
        screen.getByRole("button", { name: locale === "nl" ? "Record sluiten" : "Close Record" }),
      ).toBeDisabled();
      act(() => {
        void router.navigate({ to: "/other" });
      });
      const prompt = await screen.findByRole("alertdialog");
      expect(
        within(prompt).getByRole("button", {
          name: locale === "nl" ? "Wijzigingen verwerpen" : "Discard changes",
        }),
      ).toBeDisabled();
      await act(async () => {
        if (fail) reject(new Error("Synthetic"));
        else resolve();
      });
      if (fail) {
        fireEvent.click(
          within(prompt).getByRole("button", {
            name: locale === "nl" ? "Verder bewerken" : "Continue editing",
          }),
        );
        await waitFor(() => expect(input).toBeEnabled());
        expect(input).toHaveValue("Submitted A");
        await waitFor(() =>
          expect(
            locale === "nl" ? input : screen.getByRole("button", { name: "Save" }),
          ).toHaveFocus(),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent("Failed");
        expect(saved).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.queryByText("Other page")).toBeNull();
        expect(saved).toHaveBeenCalledTimes(1);
      }
      expect(submit.mock.calls[0][0]).toEqual({ title: "Submitted A" });
    });
  }
}
