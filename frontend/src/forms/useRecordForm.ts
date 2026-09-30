import { useLocale } from "../locale";
import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, errorMessage, type ErrorFallback } from "../query/api";

type RecordFormOptions<TValues, TResult> = {
  defaultValues: TValues;
  /** Persists the values. Throw (an `ApiError` keeps field-level detail) to report a failure. */
  submit: (values: TValues) => Promise<TResult>;
  /** Runs after a successful submit, once the form has reset to the saved values. */
  onSuccess?: (result: TResult, values: TValues) => void;
  /** Message for a failure that carries none of its own. */
  fallback: ErrorFallback;
  /** Maps the server's field names to form field names for `ApiError.fieldErrors`. */
  serverFields?: Record<string, string>;
};

/**
 * The shared owner editor contract on top of TanStack Form: default values,
 * synchronous validation (per field), dirty state relative to the last saved
 * values, submit-pending state, server errors (form- and field-level) and
 * reset-after-success. Pair it with `RecordForm` and `TextField`.
 */
export function useRecordForm<TValues extends Record<string, unknown>, TResult = void>({
  defaultValues,
  submit,
  onSuccess,
  fallback,
  serverFields = {},
}: RecordFormOptions<TValues, TResult>) {
  const formRef = useRef<HTMLFormElement>(null);
  // TanStack Form re-applies `defaultValues` on every render where they differ from the ones it saw last and the
  // form is untouched. The baseline therefore lives in a ref and is handed back unchanged after each reset, so
  // loading a record into the editor is not undone by the next render.
  const baseline = useRef(defaultValues);
  useLocale();
  const [failure, setFailure] = useState<unknown>(null);
  const serverError = failure ? errorMessage(failure, fallback) : null;
  const serverFieldErrors: Record<string, string> = {};
  if (failure instanceof ApiError) {
    for (const [name, message] of Object.entries(failure.fieldErrors))
      if (serverFields[name]) serverFieldErrors[serverFields[name]] = message;
  }
  const form = useForm({
    defaultValues: baseline.current,
    onSubmit: async ({ value, formApi }) => {
      setFailure(null);
      let result: TResult;
      try {
        result = await submit(value);
      } catch (error) {
        setFailure(error);
        return;
      }
      baseline.current = value;
      formApi.reset(value);
      onSuccess?.(result, value);
    },
    onSubmitInvalid: () => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const pending = useStore(form.store, (state) => state.isSubmitting);
  const dirty = useStore(form.store, (state) => !state.isDefaultValue);

  // A server rejection describes the values that were sent; editing makes it stale.
  const sent = useRef(values);
  useEffect(() => {
    if (sent.current === values) return;
    sent.current = values;
    setFailure(null);
  }, [values]);

  /** Loads a record (or a blank one) into the editor and makes it the clean baseline. */
  const load = useCallback(
    (next: TValues) => {
      setFailure(null);
      baseline.current = next;
      form.reset(next);
    },
    [form],
  );

  return { form, formRef, values, serverError, serverFieldErrors, pending, dirty, load };
}
