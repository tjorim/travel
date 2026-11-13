import { Button } from "@/ui/button";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useState } from "react";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { FollowAudienceAudience, FollowAudienceResult } from "../../api-types";
import { DeleteConfirmation } from "../../RecordDialog";
import { usePublicationMutations } from "./use-publication-mutations";

type Choice = "both" | "visit" | "stay";
const KINDS: Record<Choice, ("visit" | "stay")[]> = {
  both: ["visit", "stay"],
  visit: ["visit"],
  stay: ["stay"],
};

const audienceName = (audience: FollowAudienceAudience) =>
  audience.audience === "public"
    ? m.assets_the_page_for_everyone()
    : m.assets_link({ p0: audience.label ?? "" });

const countsText = (counts: { visits: number; stays: number }) =>
  [
    counts.visits ? m.assets_count_visits({ count: counts.visits }) : "",
    counts.stays ? m.assets_count_stays({ count: counts.stays }) : "",
  ]
    .filter(Boolean)
    .join(", ");

/** Lets visits and stays follow each audience's date precision in one step, after showing who will see more. */
export function FollowAudiencePrecision({
  tripId,
  onDone,
  onError,
}: {
  tripId: string;
  /** Takes a message function so the notice follows a later change of language. */
  onDone: (message: () => string) => void;
  onError: (error: unknown) => void;
}) {
  useLocale();
  const { followAudience } = usePublicationMutations(tripId);
  const [choice, setChoice] = useState<Choice>("both");
  const [review, setReview] = useState<{ choice: Choice; result: FollowAudienceResult } | null>(
    null,
  );
  const [acknowledged, setAcknowledged] = useState(false);

  async function check() {
    try {
      const result = await followAudience.mutateAsync({ kinds: KINDS[choice], confirm: false });
      if (result.changed.visits + result.changed.stays === 0) {
        onDone(() => m.precision_follow_nothing());
        return;
      }
      setAcknowledged(false);
      setReview({ choice, result });
    } catch (error) {
      onError(error);
    }
  }

  async function apply() {
    if (!review) return;
    const { choice: chosen, result } = review;
    setReview(null);
    try {
      const applied = await followAudience.mutateAsync({
        kinds: KINDS[chosen],
        confirm: true,
        confirmWidening: result.audiences.some(
          (audience) => audience.widened.visits + audience.widened.stays > 0,
        ),
      });
      const count = applied.changed.visits + applied.changed.stays;
      onDone(() => m.precision_follow_done({ count }));
    } catch (error) {
      onError(error);
    }
  }

  const widened = review?.result.audiences.filter(
    (audience) => audience.widened.visits + audience.widened.stays > 0,
  );
  const narrowed = review?.result.audiences.filter(
    (audience) => audience.narrowed.visits + audience.narrowed.stays > 0,
  );

  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.precision_follow_title()}</h3>
          <p>{m.precision_follow_intro()}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field>
          <FieldLabel>{m.precision_follow_apply_to()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.precision_follow_apply_to()}
            value={choice}
            onChange={(value) => setChoice(value as Choice)}
          >
            <option value="both">{m.precision_follow_both()}</option>
            <option value="visit">{m.owner_visits()}</option>
            <option value="stay">{m.owner_stays()}</option>
          </SearchSelect>
        </Field>
        <Button
          className="secondary"
          type="button"
          disabled={followAudience.isPending}
          onClick={() => void check()}
        >
          {m.precision_follow_button()}
        </Button>
      </div>
      {review && (
        <DeleteConfirmation
          title={m.precision_follow_confirm_title()}
          description={m.precision_follow_confirm_description({
            count: review.result.changed.visits + review.result.changed.stays,
          })}
          confirmLabel={m.precision_follow_confirm()}
          confirmDisabled={!!widened?.length && !acknowledged}
          onCancel={() => setReview(null)}
          onConfirm={() => void apply()}
        >
          {!!widened?.length && (
            <>
              <ul className="m-0 grid gap-1 pl-5 font-semibold text-travel-review-warning">
                {widened.map((audience) => (
                  <li key={audience.audience}>
                    {m.precision_follow_widened({
                      audience: audienceName(audience),
                      counts: countsText(audience.widened),
                    })}
                  </li>
                ))}
              </ul>
              <Field>
                <FieldLabel className="flex items-center gap-2 font-semibold">
                  <TravelCheckbox checked={acknowledged} onCheckedChange={setAcknowledged} />
                  <span>{m.precision_follow_acknowledge()}</span>
                </FieldLabel>
              </Field>
            </>
          )}
          {!!narrowed?.length && (
            <ul className="m-0 grid gap-1 pl-5">
              {narrowed.map((audience) => (
                <li key={audience.audience}>
                  {m.precision_follow_narrowed({
                    audience: audienceName(audience),
                    counts: countsText(audience.narrowed),
                  })}
                </li>
              ))}
            </ul>
          )}
        </DeleteConfirmation>
      )}
    </div>
  );
}
