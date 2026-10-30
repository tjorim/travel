import { flushSync } from "react-dom";
import { useLocale } from "../locale";
import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useRef, useState } from "react";

import { readRecovery, recordRecoveryKey, serializableRecord } from "./record-recovery";
import { useEditGuard } from "./navigation-guard";

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
  const recoveryKey = recordRecoveryKey(baseline.current);
  const [recovery] = useState(() => readRecovery<TValues>(recoveryKey));
  useLocale();
  const [pending, setPending] = useState(false);
  const requestFocus = useRef<HTMLElement | null>(null);
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
      requestFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPending(true);
      let result: TResult;
      try {
        result = await submit(value);
      } catch (error) {
        setFailure(error);
        setPending(false);
        return;
      }
      baseline.current = value;
      // Publish the clean/non-pending state before callbacks can navigate.
      flushSync(() => {
        formApi.reset(value);
        setPending(false);
      });
      onSuccess?.(result, value);
    },
    onSubmitInvalid: () => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const dirty = useStore(form.store, (state) => !state.isDefaultValue);

  useEditGuard(dirty, pending, () => {
    form.reset(baseline.current);
  });
  useEffect(() => {
    if (!pending && requestFocus.current?.isConnected) {
      requestFocus.current.focus();
      requestFocus.current = null;
    }
  }, [pending]);

  // beforeunload is advisory (notably on mobile). Keep a tab-scoped recovery
  // snapshot as edits happen; a matching baseline prevents applying it to another
  // record. A normal reset/discard removes it, and files are never serialised.
  const recovered = useRef(false);
  const restore = useCallback(
    (next: TValues) => {
      if (recovered.current) return;
      if (!recovery || recovery.baseline !== JSON.stringify(next)) return;
      const saved = recovery.values;
      recovered.current = true;
      for (const name of Object.keys(saved)) {
        form.setFieldValue(name as never, saved[name] as never);
      }
    },
    [form, recovery],
  );
  useEffect(() => {
    restore(baseline.current);
  }, [restore]);
  useEffect(() => {
    try {
      if (dirty && serializableRecord(values)) {
        sessionStorage.setItem(
          recoveryKey,
          JSON.stringify({ baseline: JSON.stringify(baseline.current), values }),
        );
      } else sessionStorage.removeItem(recoveryKey);
    } catch {
      // Storage may be unavailable or full; the browser unload warning still applies.
    }
  }, [dirty, values, recoveryKey]);

  useEffect(
    () => () => {
      // React unmount means an intentional in-app departure. Reload/tab termination
      // does not unmount React, so its emergency snapshot remains recoverable.
      try {
        sessionStorage.removeItem(recoveryKey);
      } catch {
        /* Optional recovery storage. */
      }
    },
    [recoveryKey],
  );

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
      const previousKey = recordRecoveryKey(baseline.current);
      const nextKey = recordRecoveryKey(next);
      const saved = nextKey !== previousKey ? readRecovery<TValues>(nextKey) : null;
      try {
        sessionStorage.removeItem(previousKey);
      } catch {
        /* Optional recovery storage. */
      }
      baseline.current = next;
      form.reset(next);
      if (saved?.baseline === JSON.stringify(next)) {
        for (const name of Object.keys(saved.values)) {
          form.setFieldValue(name as never, saved.values[name] as never);
        }
      }
    },
    [form],
  );

  return { form, formRef, values, serverError, serverFieldErrors, pending, dirty, load };
}
