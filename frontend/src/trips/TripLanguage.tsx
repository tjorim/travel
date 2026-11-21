import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { TravelCheckbox } from "@/components/ui/TravelCheckbox";
import { useState } from "react";

import { type ContentLanguage } from "@/i18n/content-language";
import { useConfirmation } from "@/hooks/useConfirmation";
import { useLocale } from "@/i18n/locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "@/lib/api/api";
import { ownerKeys } from "@/lib/query/keys";
import { useOwnerMutation } from "@/lib/query/owner-queries";
import type { Trip } from "../api-types";

const languageName = (language: ContentLanguage) =>
  language === "nl" ? m.localized_dutch() : m.localized_english();

/**
 * The language the trip's texts are written in (#376): what a plain `title` stands for and what the owner's lists
 * show first. It can also move every text of the trip to the other language in one step, for a trip that was
 * entered in the wrong one; that is asked for twice, because it rewrites many records.
 *
 * It saves on its own (not with the trip's details), so it is offered only while those have no unsaved changes.
 */
export function TripLanguage({
  trip,
  dirty,
  onPending,
  onChanged,
}: {
  trip: Trip;
  dirty: boolean;
  /** Called with whether the change is being saved. */
  onPending: (pending: boolean) => void;
  onChanged: (saved: Trip) => void;
}) {
  useLocale();
  const current = trip.content_language;
  const [chosen, setChosen] = useState<ContentLanguage>(current);
  const [move, setMove] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const confirmation = useConfirmation();
  const save = useOwnerMutation<{ language: ContentLanguage; move: boolean }, Trip>({
    fallback: m.trips_the_trip_could_not_be_saved,
    request: ({ language, move: moveTexts }) => ({
      path: `/api/trips/${encodeURIComponent(trip.id)}`,
      method: "PATCH",
      body: { content_language: language, ...(moveTexts ? { move_texts: true } : {}) },
    }),
    // A move rewrites the texts of every record of the trip, so every cached copy of one is stale.
    invalidate: (subject) => [ownerKeys.trips(subject), ownerKeys.anyTrip(subject)],
  });
  const changed = chosen !== current;

  function submit() {
    setError(null);
    onPending(true);
    save.mutateAsync({ language: chosen, move: move && changed }).then(
      (saved) => {
        onPending(false);
        setMove(false);
        onChanged(saved);
      },
      (failure: unknown) => {
        onPending(false);
        setError(failure);
      },
    );
  }
  function apply() {
    if (!changed) return;
    if (move)
      confirmation.ask({
        title: () => m.trips_move_texts_title({ language: languageName(chosen) }),
        description: () =>
          m.trips_move_texts_warning({
            language: languageName(chosen),
            from: languageName(current),
          }),
        confirmLabel: () => m.trips_move_texts_action({ language: languageName(chosen) }),
        onConfirm: submit,
      });
    else submit();
  }

  return (
    <section className="grid gap-2" aria-labelledby="trip-language-title">
      <h3 id="trip-language-title" className="m-0 text-base">
        {m.trips_content_language_title()}
      </h3>
      <p className="help m-0">{m.trips_content_language_hint()}</p>
      <ChoiceGroup
        label={m.trips_content_language_label()}
        value={chosen}
        choices={[
          { value: "nl", label: languageName("nl") },
          { value: "en", label: languageName("en") },
        ]}
        onChange={(language) => {
          setChosen(language);
          if (language === current) setMove(false);
        }}
      />
      {changed && (
        <Field>
          <FieldLabel className="flex items-center gap-2">
            <TravelCheckbox checked={move} onCheckedChange={setMove} />
            {m.trips_move_texts_label({
              from: languageName(current),
              language: languageName(chosen),
            })}
          </FieldLabel>
          <FieldDescription className="text-xs text-travel-muted">
            {m.trips_move_texts_hint()}
          </FieldDescription>
        </Field>
      )}
      {dirty && changed && <p className="help m-0">{m.trips_content_language_save_first_hint()}</p>}
      <div>
        <Button
          type="button"
          className="compact secondary"
          disabled={!changed || dirty || save.isPending}
          onClick={apply}
        >
          {m.trips_content_language_action()}
        </Button>
      </div>
      {error !== null && (
        <Alert variant="error" role="alert">
          {errorMessage(error, m.trips_the_trip_could_not_be_saved)}
        </Alert>
      )}
      {confirmation.dialog}
    </section>
  );
}
