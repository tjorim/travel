import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ApiError } from "../../query/api";
import { DeleteConfirmation } from "../../RecordDialog";
import type { ExclusionWidening, KindCounts } from "../../tracker-model";
import { kindCountsText } from "./catalog";

export const EXCLUSION_WIDENING_CODE = "exclusion_widening_needs_acknowledgement";

/** The review the server sent when saving would show an active audience records it does not receive now, if that is why a save was refused. */
export function exclusionWidening(error: unknown): ExclusionWidening | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.diagnostic as { code?: string; counts?: KindCounts } | undefined;
  return detail?.code === EXCLUSION_WIDENING_CODE ? (detail as unknown as ExclusionWidening) : null;
}

/**
 * Removing an exclusion from an active link or collection shows its visitors more, so the owner confirms it first,
 * as for the other changes that widen an audience.
 */
export function ExclusionWideningDialog({
  widening,
  onCancel,
  onConfirm,
}: {
  widening: ExclusionWidening;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useLocale();
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <DeleteConfirmation
      title={m.exclusions_widen_title()}
      description={m.exclusions_widen_description({ counts: kindCountsText(widening.counts) })}
      confirmLabel={m.exclusions_widen_confirm()}
      confirmDisabled={!acknowledged}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <Field>
        <FieldLabel className="flex items-center gap-2 font-semibold">
          <TravelCheckbox checked={acknowledged} onCheckedChange={setAcknowledged} />
          <span>{m.exclusions_widen_acknowledge()}</span>
        </FieldLabel>
      </Field>
    </DeleteConfirmation>
  );
}
