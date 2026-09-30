// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { changeLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { ApiError, apiFailure, errorMessage } from "./api";
import { errorNotice, useFeedback, FeedbackError } from "./feedback";
import { useRecordForm } from "../forms/useRecordForm";

afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});
const descriptor = (code: string, params = {}, path: (string | number)[] = []) => ({ code, params, path });

it("updates an already-visible mutation error without replacing the input or losing focus", async () => {
  const error = await apiFailure(
    new Response(
      JSON.stringify({ detail: "private diagnostic", errors: [descriptor("arrival_must_be_after_departure")] }),
      { status: 422 },
    ),
    "fallback",
  );
  function Screen() {
    const [notice, setNotice] = useFeedback<string>("");
    return (
      <>
        <input aria-label="draft" defaultValue="Authored text" />
        <button onClick={() => setNotice(errorNotice(error, "fallback"))}>fail</button>
        <p role="alert">{notice}</p>
      </>
    );
  }
  render(<Screen />);
  fireEvent.click(screen.getByText("fail"));
  const input = screen.getByLabelText("draft");
  input.focus();
  expect(screen.getByRole("alert").textContent).toBe("De aankomst moet na het vertrek liggen.");
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert").textContent).toBe("Arrival must be after departure");
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe("Authored text");
  expect(document.body.textContent).not.toContain("private diagnostic");
});

it("rerenders mapped validation fields and clears the rejection when the submitted values change", async () => {
  const error = new ApiError("fallback", 422, [descriptor("string_too_long", { max_length: 3 }, ["body", "label"])]);
  function Editor() {
    const record = useRecordForm({
      defaultValues: { name: "Authored" },
      submit: () => Promise.reject(error),
      fallback: "fallback",
      serverFields: { label: "name" },
    });
    return (
      <>
        <button onClick={() => void record.form.handleSubmit()}>save</button>
        <button onClick={() => record.form.setFieldValue("name", "new")}>edit</button>
        <p role="alert">{record.serverFieldErrors.name}</p>
        <p role="status">{record.serverError}</p>
      </>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByText("save"));
  expect(await screen.findAllByText("Gebruik maximaal 3 tekens.")).toHaveLength(2);
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert").textContent).toBe("Use at most 3 characters.");
  expect(screen.getByRole("status").textContent).toBe("Use at most 3 characters.");
  fireEvent.click(screen.getByText("edit"));
  expect(screen.getByRole("alert").textContent).toBe("");
});

it("handles known conflicts, provider and dependency failures, unknown codes and plural counts in both locales", () => {
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    expect(new ApiError("fallback", 401).message).toBe(m.api_unauthorized());
    for (const code of [
      "provider_failed",
      "this_import_session_has_expired",
      "only_an_active_link_can_be_rotated",
      "one_or_more_media_assets_are_unavailable_for_this_trip",
      "one_or_more_documents_are_unavailable_for_this_trip",
    ]) {
      const error = new ApiError("fallback", 409, [descriptor(code)]);
      expect(error.message).not.toBe(m.api_operation_failed());
    }
    expect(new ApiError("remote prose", 409, [descriptor("future")]).message).toBe(m.api_operation_failed());
    for (const count of [0, 1, 3]) {
      const error = new ApiError("fallback", 409, [descriptor("resource_in_use", { count })]);
      expect(error.message).toBe(m.api_resource_in_use({ count }));
      expect(m.api_selection_failed({ count, labels: "Authored", reason: "reason" })).toContain(
        locale === "en"
          ? count === 1
            ? "record was"
            : "records were"
          : count === 1
            ? "onderdeel is"
            : "onderdelen zijn",
      );
    }
  }
});

it("uses a typed operation fallback for an unknown response, reevaluated in the current locale", () => {
  const error = new ApiError(m.api_capture_save, 503, [descriptor("future_code")]);
  expect(error.message).toContain("Je lokale concept blijft bewaard.");
  act(() => changeLocale("en"));
  expect(error.message).toContain("Your local draft is kept.");
});

it("uses a current-locale fallback for unexpected diagnostics and preserves explicit local feedback", () => {
  const remote = new Error("Remote diagnostic: Authored confidential input");
  const local = new FeedbackError(() => m.owner_also_enter_a_start_time());
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    expect(errorMessage(remote, m.api_operation_failed)).toBe(m.api_operation_failed());
    expect(errorMessage(local, m.api_operation_failed)).toBe(m.owner_also_enter_a_start_time());
    expect(errorMessage(new ApiError(m.retry_description, 409, [descriptor("future_code")]), m.retry_description)).toBe(
      m.retry_description(),
    );
  }
});
