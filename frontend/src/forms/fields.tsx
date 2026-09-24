import type { AnyFieldApi } from "@tanstack/react-form";
import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type ServerErrors = Record<string, string>;
const ServerFieldErrors = createContext<ServerErrors>({});

export type RecordFormState = {
  form: { handleSubmit: () => Promise<void> };
  formRef: RefObject<HTMLFormElement | null>;
  serverError: string | null;
  serverFieldErrors: ServerErrors;
  pending: boolean;
};

/** The form shell of the shared editor: submit handling, server error and pending button. */
export function RecordForm({ record, submitLabel, pendingLabel, actions, children }: { record: RecordFormState; submitLabel: string; pendingLabel: string; actions?: ReactNode; children: ReactNode }) {
  const { form, formRef, serverError, serverFieldErrors, pending } = record;
  return <ServerFieldErrors.Provider value={serverFieldErrors}>
    <form ref={formRef} className="stack-form" noValidate aria-busy={pending} onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      {children}
      {serverError && <p className="form-error" role="alert">{serverError}</p>}
      <div className="button-row"><button type="submit" disabled={pending}>{pending ? pendingLabel : submitLabel}</button>{actions}</div>
    </form>
  </ServerFieldErrors.Provider>;
}

function useFieldErrors(field: AnyFieldApi) {
  const server = useContext(ServerFieldErrors)[field.name];
  const errors = [...field.state.meta.errors.map((error: unknown) => typeof error === "string" ? error : (error as { message?: string } | null)?.message ?? ""), server ?? ""].filter(Boolean);
  const describedBy = useId();
  return { message: errors[0] ?? null, invalid: errors.length > 0, describedBy };
}

type Common = { field: AnyFieldApi; label: string; optional?: string | boolean };

const optionalNote = (optional: Common["optional"]) => optional ? <> <span className="optional">{typeof optional === "string" ? optional : "(optioneel)"}</span></> : null;

export function TextField({ field, label, optional, ...input }: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "name">) {
  const { message, invalid, describedBy } = useFieldErrors(field);
  const { required, ...rest } = input;
  return <div className="field">
    <label>{label}{optionalNote(optional)}
      <input {...rest} name={field.name} value={field.state.value ?? ""} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={message ? describedBy : undefined} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
    </label>
    {message && <span id={describedBy} className="field-error" role="alert">{message}</span>}
  </div>;
}

export function TextAreaField({ field, label, optional, ...input }: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur" | "name">) {
  const { message, invalid, describedBy } = useFieldErrors(field);
  const { required, ...rest } = input;
  return <div className="field">
    <label>{label}{optionalNote(optional)}
      <textarea {...rest} name={field.name} value={field.state.value ?? ""} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={message ? describedBy : undefined} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
    </label>
    {message && <span id={describedBy} className="field-error" role="alert">{message}</span>}
  </div>;
}

export function SelectField({ field, label, optional, children, ...input }: Common & { children: ReactNode } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "onBlur" | "name">) {
  const { message, invalid, describedBy } = useFieldErrors(field);
  return <div className="field">
    <label>{label}{optionalNote(optional)}
      <select {...input} name={field.name} value={field.state.value ?? ""} aria-invalid={invalid || undefined} aria-describedby={message ? describedBy : undefined} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)}>{children}</select>
    </label>
    {message && <span id={describedBy} className="field-error" role="alert">{message}</span>}
  </div>;
}

/** The value is required once trimmed. */
export const requiredText = (message: string) => ({ value }: { value: string }) => value.trim() ? undefined : message;
