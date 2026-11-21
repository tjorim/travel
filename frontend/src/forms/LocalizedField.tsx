import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Button } from "@/ui/button";
import { useField, type AnyFieldApi, type AnyFormApi } from "@tanstack/react-form";
import { useEffect, useState } from "react";

import { otherLanguage, useContentLanguage, type ContentLanguage } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { m } from "../paraglide/messages.js";
import { TextField } from "./fields";
import { MarkdownField, type MarkdownFormat } from "./MarkdownField";
import { TranslationDraft } from "./TranslationDraft";

const languageName = (language: ContentLanguage) =>
  language === "nl" ? m.localized_dutch() : m.localized_english();

/** The form value names behind one localized field: `title` is `titleNl` and `titleEn`. */
export const localizedNames = (name: string) => ({ nl: `${name}Nl`, en: `${name}En` });

/**
 * The two language versions of one authored field (#376) as form values `<name>Nl` and `<name>En`.
 * Only one version is on screen: a Dutch | English switch (the trip's content language first) chooses which,
 * says which version is still empty, and offers one draft action, for the empty language. A draft fills
 * that version, marked as an unreviewed machine draft until the record is saved.
 *
 * `required` makes the field need text in at least one language; clearing one is always allowed.
 */
export function LocalizedField({
  form,
  name,
  required,
  requiredMessage,
  validate,
  listenTo = [],
  ...view
}: {
  form: AnyFormApi;
  name: string;
  /** At least one language must have text; `requiredMessage` is the error when both are empty. */
  required?: boolean;
  requiredMessage?: () => string;
  /** A further rule over the whole field (both languages), re-run when the fields named in `listenTo` change. */
  validate?: (props: { fieldApi: AnyFieldApi }) => string | (() => string) | undefined;
  listenTo?: string[];
} & Omit<ViewProps, "fields" | "required">) {
  const names = localizedNames(name);
  const atLeastOne = ({ fieldApi }: { fieldApi: AnyFieldApi }) =>
    required &&
    !String(fieldApi.form.getFieldValue(names.nl) ?? "").trim() &&
    !String(fieldApi.form.getFieldValue(names.en) ?? "").trim()
      ? requiredMessage
      : undefined;
  const check = (props: { fieldApi: AnyFieldApi }) => atLeastOne(props) ?? validate?.(props);
  const validators = (other: string) =>
    required || validate
      ? { onChangeListenTo: [other, ...listenTo], onChange: check, onSubmit: check }
      : undefined;
  const fields: Record<ContentLanguage, AnyFieldApi> = {
    nl: useField({
      form,
      name: names.nl as never,
      validators: validators(names.en) as never,
    }) as unknown as AnyFieldApi,
    en: useField({
      form,
      name: names.en as never,
      validators: validators(names.nl) as never,
    }) as unknown as AnyFieldApi,
  };
  return <LocalizedFieldView {...view} fields={fields} required={required} />;
}

type ViewProps = {
  /** The two versions as form fields, or anything shaped like one (see `plainField`). */
  fields: Record<ContentLanguage, AnyFieldApi>;
  label: string;
  kind?: "text" | "markdown";
  required?: boolean;
  /** Which language is shown first; the trip's content language by default. */
  language?: ContentLanguage;
  optional?: string | boolean;
  format?: MarkdownFormat;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
};

/** A field-shaped view of plain state, for an editor that is not a TanStack form. */
export function plainField(
  name: string,
  value: string,
  saved: string,
  onChange: (value: string) => void,
): AnyFieldApi {
  return {
    name,
    state: { value, meta: { errors: [], isDefaultValue: value === saved } },
    handleChange: onChange,
    handleBlur: () => undefined,
  } as unknown as AnyFieldApi;
}

/** The switch, the field of the language on screen and the draft action over two ready-made fields. */
export function LocalizedFieldView({
  fields,
  label,
  kind = "text",
  required,
  language: initial,
  optional,
  format,
  ...input
}: ViewProps) {
  useLocale();
  const contentLanguage = useContentLanguage();
  const main = initial ?? contentLanguage;
  const [shown, setShown] = useState<ContentLanguage>(main);
  // The trip's language changed (and its texts may have moved with it): start from the new main language.
  useEffect(() => setShown(main), [main]);
  const [drafted, setDrafted] = useState<Record<ContentLanguage, boolean>>({
    nl: false,
    en: false,
  });
  const value = (language: ContentLanguage) => String(fields[language].state.value ?? "");
  const other = otherLanguage(shown);
  const empty = (language: ContentLanguage) => !value(language).trim();

  // A draft stops being "unreviewed" once the record is saved: the field is back at its saved value.
  const clean = fields.nl.state.meta.isDefaultValue && fields.en.state.meta.isDefaultValue;
  useEffect(() => {
    if (clean) setDrafted({ nl: false, en: false });
  }, [clean]);

  const choice = (language: ContentLanguage) => {
    const isMain = language === main;
    const isEmpty = empty(language);
    return {
      value: language,
      label:
        isMain && isEmpty
          ? m.localized_choice_main_empty({ language: languageName(language) })
          : isMain
            ? m.localized_choice_main({ language: languageName(language) })
            : isEmpty
              ? m.localized_choice_empty({ language: languageName(language) })
              : languageName(language),
    };
  };
  const choices = [main, otherLanguage(main)].map(choice);
  const active = fields[shown];
  const companion = fields[other];
  const common = { field: active, companion, label, optional, lang: shown, required, ...input };
  const reviewing = drafted[shown] && !empty(shown) && !active.state.meta.isDefaultValue;

  return (
    <div className="grid gap-2">
      <ChoiceGroup
        label={m.localized_language_of({ label })}
        hideLabel
        value={shown}
        choices={choices}
        onChange={setShown}
      />
      {kind === "markdown" ? (
        <MarkdownField key={shown} {...common} format={format} />
      ) : (
        <TextField key={shown} {...common} />
      )}
      {empty(shown) && !empty(other) && (
        <div className="grid gap-1">
          <p className="help m-0">
            {m.localized_fallback_hint({
              language: languageName(shown),
              other: languageName(other),
            })}
          </p>
          <TranslationDraft
            key={shown}
            source={other}
            target={shown}
            text={value(other)}
            onDraft={(draft) => {
              active.handleChange(draft);
              setDrafted((previous) => ({ ...previous, [shown]: true }));
            }}
          />
        </div>
      )}
      {reviewing && (
        <div
          className="grid gap-1 rounded-lg border border-dashed border-travel-control-border p-2"
          role="status"
        >
          <p className="m-0 text-sm font-bold">{m.translations_unreviewed_draft_title()}</p>
          <p className="help m-0">{m.translations_check_hint()}</p>
          <div>
            <Button
              type="button"
              className="compact secondary"
              onClick={() => {
                active.handleChange("");
                setDrafted((previous) => ({ ...previous, [shown]: false }));
              }}
            >
              {m.translations_discard_draft()}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
