import { CalendarIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Input } from "@/ui/input";
import type { AnyFieldApi } from "@tanstack/react-form";
import {
  dateFromIso,
  formatDateInput,
  formatTimeInput,
  isoFromDate,
  joinDateTime,
  parseDateInput,
  parseTimeInput,
  splitDateTime,
} from "../date-input";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Calendar } from "@/ui/calendar";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { optionalNote, useFieldErrors } from "./fields";
import { UNREADABLE_ENTRY } from "./unreadable-entry";

type PickerProps = {
  field: AnyFieldApi;
  label: string;
  optional?: string | boolean;
  required?: boolean;
  disabled?: boolean;
};

/**
 * Text the owner types for a date or time. The form keeps the machine value (`YYYY-MM-DD`, `HH:mm`), the input shows
 * it in the interface language, and text that is not readable yet stays in the input without touching the form.
 */
function useTypedEntry({
  value,
  show,
  read,
  commit,
}: {
  value: string;
  show: (value: string) => string;
  read: (text: string) => string | null;
  commit: (value: string) => void;
}) {
  useLocale();
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  const [touched, setTouched] = useState(false);
  // A value set from outside (a reset, another record loaded) replaces what was typed.
  if (value !== seen) {
    setSeen(value);
    setDraft(null);
  }
  const unreadable = draft !== null && draft.trim() !== "" && read(draft) === null;
  const apply = (next: string) => {
    setSeen(next);
    commit(next);
  };
  return {
    text: draft ?? show(value),
    unreadable,
    showUnreadable: unreadable && touched,
    change(text: string) {
      setDraft(text);
      if (!text.trim()) return apply("");
      const parsed = read(text);
      if (parsed !== null) apply(parsed);
    },
    blur() {
      setTouched(true);
      if (draft !== null && !unreadable) setDraft(null);
    },
    pick(next: string) {
      setDraft(null);
      apply(next);
    },
  };
}

type EntryProps = {
  entry: ReturnType<typeof useTypedEntry>;
  /** Overrides the entry's own reading of its text, for a part the form cannot save without. */
  unreadable?: boolean;
  placeholder: string;
  /** The accessible name when no visible label is tied to the input. */
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onFieldBlur: () => void;
  numeric?: boolean;
};

function EntryInput({
  entry,
  unreadable = entry.unreadable,
  placeholder,
  ariaLabel,
  required,
  disabled,
  inputRef,
  onFieldBlur,
  numeric,
}: EntryProps) {
  return (
    <Input
      ref={inputRef}
      type="text"
      autoComplete="off"
      inputMode={numeric ? "numeric" : undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-required={required || undefined}
      disabled={disabled}
      value={entry.text}
      {...{ [UNREADABLE_ENTRY]: unreadable ? "" : undefined }}
      onChange={(event) => entry.change(event.target.value)}
      onBlur={() => {
        entry.blur();
        onFieldBlur();
      }}
    />
  );
}

function FieldTitle({ label, optional }: Pick<PickerProps, "label" | "optional">) {
  return (
    <span>
      {label}
      {optionalNote(optional)}
    </span>
  );
}

const entryValue = (field: AnyFieldApi) => String(field.state.value ?? "");

/** A calendar button beside a date input. The popover returns focus to the input when it closes. */
function DateInput({
  entry,
  unreadable,
  label,
  ariaLabel,
  required,
  disabled,
  min,
  onFieldBlur,
  iso,
}: Omit<EntryProps, "placeholder" | "numeric" | "inputRef"> & {
  label: string;
  min?: string;
  iso: string;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selected = dateFromIso(iso);
  const earliest = min ? dateFromIso(min) : undefined;
  return (
    <div className="flex items-stretch gap-1.5">
      <EntryInput
        entry={entry}
        unreadable={unreadable}
        inputRef={input}
        placeholder={m.owner_date_placeholder()}
        ariaLabel={ariaLabel}
        required={required}
        disabled={disabled}
        onFieldBlur={onFieldBlur}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          className="secondary compact min-w-11 shrink-0 px-3"
          disabled={disabled}
          aria-label={m.owner_choose_date_in_calendar({ label })}
        >
          <CalendarIcon className="size-4" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" finalFocus={input}>
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected ?? earliest}
            disabled={earliest ? { before: earliest } : undefined}
            onSelect={(date) => {
              if (!date) return;
              entry.pick(isoFromDate(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FieldFrame({
  field,
  label,
  optional,
  unreadable,
  children,
}: PickerProps & { unreadable: string | null; children: ReactNode }) {
  const { message, invalid } = useFieldErrors(field);
  const error = unreadable ?? message;
  return (
    <Field name={field.name} invalid={invalid || Boolean(unreadable)}>
      <FieldLabel>
        <FieldTitle label={label} optional={optional} />
      </FieldLabel>
      {children}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

/**
 * A date typed as "16 nov 2026" (or "16-11-2026", or ISO) with a calendar to pick from. The form value stays
 * `YYYY-MM-DD`. `min` greys out earlier days in the calendar; it does not validate.
 */
export function DateField({
  field,
  label,
  optional,
  required,
  disabled,
  min,
}: PickerProps & { min?: string }) {
  const locale = useLocale();
  const value = entryValue(field);
  const entry = useTypedEntry({
    value,
    show: (iso) => formatDateInput(iso, locale),
    read: parseDateInput,
    commit: field.handleChange,
  });
  return (
    <FieldFrame
      field={field}
      label={label}
      optional={optional}
      unreadable={entry.showUnreadable ? m.owner_date_unreadable() : null}
    >
      <DateInput
        entry={entry}
        iso={value}
        label={label}
        required={required}
        disabled={disabled}
        min={min}
        onFieldBlur={field.handleBlur}
      />
    </FieldFrame>
  );
}

/** A 24-hour time typed as "18:30" (or "1830"); the form value stays `HH:mm` in both interface languages. */
export function TimeField({ field, label, optional, required, disabled }: PickerProps) {
  const entry = useTypedEntry({
    value: entryValue(field),
    show: formatTimeInput,
    read: parseTimeInput,
    commit: field.handleChange,
  });
  return (
    <FieldFrame
      field={field}
      label={label}
      optional={optional}
      unreadable={entry.showUnreadable ? m.owner_time_unreadable() : null}
    >
      <EntryInput
        entry={entry}
        numeric
        placeholder={m.owner_time_placeholder()}
        required={required}
        disabled={disabled}
        onFieldBlur={field.handleBlur}
      />
    </FieldFrame>
  );
}

/**
 * A date and a 24-hour time entered side by side. The form value stays `YYYY-MM-DDTHH:mm` and is empty until both
 * parts are filled in; a half-filled entry says so instead of silently saving nothing.
 */
export function DateTimeField({ field, label, optional, required, disabled }: PickerProps) {
  const locale = useLocale();
  const value = entryValue(field);
  const { date, time } = splitDateTime(value);
  // The parts are kept apart: one can be filled before the other, while the form value needs both.
  const [parts, setParts] = useState({ date, time });
  const [seen, setSeen] = useState(value);
  const [left, setLeft] = useState(false);
  if (value !== seen) {
    setSeen(value);
    setParts({ date, time });
  }
  const update = (next: Partial<typeof parts>) => {
    const merged = { ...parts, ...next };
    setParts(merged);
    const joined = joinDateTime(merged.date, merged.time);
    setSeen(joined);
    field.handleChange(joined);
  };
  const dateEntry = useTypedEntry({
    value: parts.date,
    show: (iso) => formatDateInput(iso, locale),
    read: parseDateInput,
    commit: (next) => update({ date: next }),
  });
  const timeEntry = useTypedEntry({
    value: parts.time,
    show: formatTimeInput,
    read: parseTimeInput,
    commit: (next) => update({ time: next }),
  });
  const { message, invalid } = useFieldErrors(field);
  const missingDate = parts.date === "" && parts.time !== "";
  const missingTime = parts.time === "" && parts.date !== "";
  const error = dateEntry.showUnreadable
    ? m.owner_date_unreadable()
    : timeEntry.showUnreadable
      ? m.owner_time_unreadable()
      : left && (missingDate || missingTime)
        ? m.owner_date_and_time_both()
        : message;
  return (
    <FieldSet
      className="grid content-start gap-1.5 border-0 p-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setLeft(true);
      }}
    >
      <FieldLegend className="p-0">
        <FieldTitle label={label} optional={optional} />
      </FieldLegend>
      <div className="grid grid-cols-5 gap-2">
        <Field
          className="col-span-3"
          name={`${field.name}-date`}
          invalid={invalid || Boolean(error)}
        >
          <DateInput
            entry={dateEntry}
            unreadable={dateEntry.unreadable || missingDate}
            iso={parts.date}
            label={label}
            ariaLabel={m.owner_label_date({ label })}
            required={required}
            disabled={disabled}
            onFieldBlur={field.handleBlur}
          />
        </Field>
        <Field
          className="col-span-2"
          name={`${field.name}-time`}
          invalid={invalid || Boolean(error)}
        >
          <EntryInput
            entry={timeEntry}
            unreadable={timeEntry.unreadable || missingTime}
            numeric
            placeholder={m.owner_time_placeholder()}
            ariaLabel={m.owner_label_time({ label })}
            required={required}
            disabled={disabled}
            onFieldBlur={field.handleBlur}
          />
        </Field>
      </div>
      <Field name={field.name} invalid={invalid || Boolean(error)}>
        <FieldError>{error}</FieldError>
      </Field>
    </FieldSet>
  );
}
