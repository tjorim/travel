import { Button } from "@/components/ui/button";
import { useStore, type AnyFormApi } from "@tanstack/react-form";

import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { pendingNames, type SuggestedNames } from "./place-result";
import { localizedNames } from "@/components/forms/LocalizedField";

/**
 * The provider's own Dutch and English names for a chosen place, offered for the two versions of a label (#376).
 * Nothing is applied unasked: a button fills the versions it shows, and it disappears once they are what is typed.
 * Each name is in the language its provider tag names, so it carries that `lang`.
 */
export function SuggestedNamesNotice({
  form,
  name,
  names,
}: {
  form: AnyFormApi;
  name: string;
  names: SuggestedNames | null;
}) {
  useLocale();
  const fields = localizedNames(name);
  const nl = useStore(form.store, (state) => String(state.values[fields.nl] ?? ""));
  const en = useStore(form.store, (state) => String(state.values[fields.en] ?? ""));
  const pending = pendingNames(names, { nl, en });
  if (!pending) return null;
  return (
    <div className="help m-0 grid justify-items-start gap-1.5">
      <p className="m-0">{m.localized_suggested_names()}</p>
      <ul className="m-0 grid gap-0.5 pl-4">
        {pending.nl && (
          <li>
            {m.localized_dutch()}: <span lang="nl">{pending.nl}</span>
          </li>
        )}
        {pending.en && (
          <li>
            {m.localized_english()}: <span lang="en">{pending.en}</span>
          </li>
        )}
      </ul>
      <Button
        type="button"
        className="secondary compact"
        onClick={() => {
          if (pending.nl) form.setFieldValue(fields.nl as never, pending.nl as never);
          if (pending.en) form.setFieldValue(fields.en as never, pending.en as never);
        }}
      >
        {m.localized_use_suggested_names()}
      </Button>
    </div>
  );
}
