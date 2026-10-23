import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { Field, FieldError, FieldLabel } from "@/ui/field";
import { TravelTextarea } from "@/ui/TravelTextarea";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import type { AnyFieldApi } from "@tanstack/react-form";
import {
  createContext,
  useContext,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { SearchSelect } from "@/ui/SearchCombobox";
import { SuggestInput } from "@/ui/SuggestInput";
import { timeZoneOptions } from "../tracker-model";
import { blockUnreadableEntries } from "./unreadable-entry";
export { SearchSelect, AsyncSearchSelect } from "@/ui/SearchCombobox";
export type { SearchSelectOption, SearchSelectGroup } from "@/ui/SearchCombobox";

const timeZones = timeZoneOptions();

type ServerErrors = Record<string, string>;
export const ServerFieldErrors = createContext<ServerErrors>({});

export type RecordFormState = {
  form: { handleSubmit: () => Promise<void> };
  formRef: RefObject<HTMLFormElement | null>;
  serverError: string | null;
  serverFieldErrors: ServerErrors;
  pending: boolean;
};

/** The form shell of the shared editor: submit handling, server error and pending button. */
export function RecordForm({
  record,
  submitLabel,
  pendingLabel,
  disabled = false,
  actions,
  children,
}: {
  record: RecordFormState;
  submitLabel: string;
  pendingLabel: string;
  /** Blocks submitting without a pending save, for example while a required part is missing. */ disabled?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { form, formRef, serverError, serverFieldErrors, pending } = record;
  return (
    <ServerFieldErrors.Provider value={serverFieldErrors}>
      <form
        ref={formRef}
        className="stack-form"
        noValidate
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (blockUnreadableEntries(formRef.current)) return;
          void form.handleSubmit();
        }}
      >
        {children}
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="button-row">
          <Button type="submit" disabled={pending || disabled}>
            {pending ? pendingLabel : submitLabel}
          </Button>
          {actions}
        </div>
      </form>
    </ServerFieldErrors.Provider>
  );
}

export function useFieldErrors(field: AnyFieldApi) {
  useLocale();
  const server = useContext(ServerFieldErrors)[field.name];
  const errors = [
    ...field.state.meta.errors.map((error: unknown) =>
      typeof error === "function"
        ? error()
        : typeof error === "string"
          ? error
          : ((error as { message?: string } | null)?.message ?? ""),
    ),
    server ?? "",
  ].filter(Boolean);
  return { message: errors[0] ?? null, invalid: errors.length > 0 };
}

type Common = { field: AnyFieldApi; label: string; optional?: string | boolean };

export const optionalNote = (optional: Common["optional"]) =>
  optional ? (
    <>
      {" "}
      <span className="font-medium text-travel-optional">
        {typeof optional === "string" ? optional : m.owner_optional()}
      </span>
    </>
  ) : null;

export function TextField({
  field,
  label,
  optional,
  ...input
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "name">) {
  useLocale();
  const { message, invalid } = useFieldErrors(field);
  const { required, ...rest } = input;
  return (
    <Field name={field.name} invalid={invalid}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(optional)}
        </span>
      </FieldLabel>
      <Input
        {...rest}
        value={field.state.value ?? ""}
        aria-required={required || undefined}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      <FieldError>{message}</FieldError>
    </Field>
  );
}

/** An IANA time zone typed freely, with the zones the browser knows offered as suggestions. */
export function TimeZoneField({
  field,
  label,
  optional,
  ...input
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "name">) {
  useLocale();
  const { message, invalid } = useFieldErrors(field);
  const { required, ...rest } = input;
  return (
    <Field name={field.name} invalid={invalid}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(optional)}
        </span>
      </FieldLabel>
      <SuggestInput
        {...rest}
        suggestions={timeZones}
        value={field.state.value ?? ""}
        aria-required={required || undefined}
        onBlur={field.handleBlur}
        onChange={field.handleChange}
      />
      <FieldError>{message}</FieldError>
    </Field>
  );
}

export function TextAreaField({
  field,
  label,
  optional,
  ...input
}: Common &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur" | "name">) {
  useLocale();
  const { message, invalid } = useFieldErrors(field);
  const { required, ...rest } = input;
  return (
    <Field name={field.name} invalid={invalid}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(optional)}
        </span>
      </FieldLabel>
      <TravelTextarea
        {...rest}
        value={field.state.value ?? ""}
        aria-required={required || undefined}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      <FieldError>{message}</FieldError>
    </Field>
  );
}

export function SelectField({
  field,
  label,
  optional,
  children,
  disabled,
}: Common & { children: ReactNode; disabled?: boolean }) {
  useLocale();
  const { message, invalid } = useFieldErrors(field);
  return (
    <Field name={field.name} invalid={invalid} disabled={disabled}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(optional)}
        </span>
      </FieldLabel>
      <SearchSelect
        value={field.state.value ?? ""}
        isDisabled={disabled}
        onChange={field.handleChange}
        onBlur={field.handleBlur}
        name={field.name}
      >
        {children}
      </SearchSelect>
      <FieldError>{message}</FieldError>
    </Field>
  );
}

/** The value is required once trimmed. */
export const requiredText =
  (message: string | (() => string)) =>
  ({ value }: { value: string }) =>
    value.trim() ? undefined : message;

export function CheckboxField({
  field,
  label,
  className = "flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold",
  ...input
}: { field: AnyFieldApi; label: ReactNode; className?: string } & Omit<
  ComponentProps<typeof TravelCheckbox>,
  "checked" | "defaultChecked" | "onCheckedChange" | "name" | "children" | "className"
>) {
  return (
    <Field name={field.name} className="contents">
      <FieldLabel className={className}>
        <TravelCheckbox
          {...input}
          checked={Boolean(field.state.value)}
          onBlur={field.handleBlur}
          onCheckedChange={(checked) => field.handleChange(checked)}
        />
        {label}
      </FieldLabel>
    </Field>
  );
}
