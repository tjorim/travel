import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import type { AnyFieldApi } from "@tanstack/react-form";

import { useLocale } from "@/i18n/locale";
import { optionalNote, useFieldErrors } from "./fields";

/**
 * A place's name as written where the place is (#376): a plain input, not a Dutch | English pair, because it is
 * not a version of the label. It is in a language the app cannot know, so the input says so with `lang=""` (unknown),
 * leaves the browser's spell checker and capitalisation out of it and lets a right-to-left name read the right
 * way round.
 */
export function LocalNameField({
  field,
  label,
  hint,
}: {
  field: AnyFieldApi;
  label: string;
  hint: string;
}) {
  useLocale();
  const { message, invalid } = useFieldErrors(field);
  return (
    <Field name={field.name} invalid={invalid}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(true)}
        </span>
      </FieldLabel>
      <Input
        lang=""
        dir="auto"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={120}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      <FieldDescription className="text-xs text-travel-muted">{hint}</FieldDescription>
      <FieldError>{message}</FieldError>
    </Field>
  );
}
