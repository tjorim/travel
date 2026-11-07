import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { useId, useRef, useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, useFeedback } from "../../query/feedback";
import {
  formatInstantDate,
  type PresetLabel,
  type ShareScope,
  type SharingPresetId,
  type SharingPresetReview,
} from "../../tracker-model";
import type { CatalogItem } from "./catalog";
import { PresetExceptionsList } from "./PresetExceptionsList";
import { PresetReviewDialog } from "./PresetReviewDialog";
import {
  PRESET_DESCRIPTIONS,
  PRESET_IDS,
  PRESET_NAMES,
  presetName,
  usePresetMutations,
  type PresetAppliedAudience,
  type PresetTarget,
} from "./use-sharing-presets";

/** What the picker needs to know about the audience it sits in. */
export type ScopePreset = {
  /** The saved audience a preset is reviewed for; null for a hidden link that has not been saved yet. */
  target: PresetTarget | null;
  /** Read when the owner applies, so the revision the editor holds now is the one claimed. */
  revision: () => number;
  label: PresetLabel | null;
  /** Unsaved edits in the editor. A review reads the saved audience, so it waits until they are saved or discarded. */
  dirty: boolean;
  /** For a link that is not saved yet: the preset is chosen here and goes with its creation. Absent: none. */
  creation?: { value: SharingPresetId | null; onChange: (value: SharingPresetId | null) => void };
  onApplied: (audience: PresetAppliedAudience) => void;
  /** The audience changed elsewhere: load the current record the server sent. */
  onReload: (current: PresetAppliedAudience) => void;
};

/** "Story and route, with 2 exceptions" or "Story and route, no exceptions". */
export function presetLabelText(preset: string, exceptions: number): string {
  return exceptions > 0
    ? m.preset_label_exceptions({ preset: presetName(preset), count: exceptions })
    : m.preset_label_no_exceptions({ preset: presetName(preset) });
}

/**
 * The preset picker of an audience editor: choose a preset, read its review, apply it. The audience that carries a
 * preset says so, with its exceptions and the controls to resolve them. Everything else the editor offers stays as it
 * is; a preset only fills it in.
 */
export function PresetSection({
  preset,
  scope,
  setScope,
  catalog,
  tripId,
  allowExclusions,
  disabled,
  onError,
}: {
  preset: ScopePreset;
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  catalog: CatalogItem[];
  tripId: string;
  allowExclusions: boolean;
  disabled: boolean;
  onError: (error: unknown) => void;
}) {
  useLocale();
  const headingId = useId();
  const reviewButton = useRef<HTMLButtonElement>(null);
  const { review } = usePresetMutations(tripId);
  const [chosen, setChosen] = useState<SharingPresetId | "">("");
  const [open, setOpen] = useState<SharingPresetReview | null>(null);
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [failure, setFailure] = useFeedback<string | null>(null);
  const { creation, target, label } = preset;
  const applied = label?.applied_preset ?? null;
  const exceptions = label?.preset_exceptions ?? null;

  const none = "none";
  const choices = [
    ...(creation ? [{ value: none, label: m.preset_none() }] : []),
    ...PRESET_IDS.map((id) => ({ value: id as string, label: PRESET_NAMES[id]() })),
  ];
  const value: string = creation ? (creation.value ?? none) : chosen;
  const described = value && value !== none ? (value as SharingPresetId) : null;

  async function startReview() {
    if (!target || !chosen) return;
    setFailure(null);
    setNotice(null);
    try {
      setOpen(await review.mutateAsync({ target, preset: chosen }));
    } catch (error) {
      setFailure(errorNotice(error, m.preset_review_failed));
    }
  }

  const blocked = preset.dirty ? m.preset_save_first() : !chosen ? m.preset_choose_first() : null;

  return (
    <section className="grid gap-2.5" aria-labelledby={headingId}>
      <div className="grid gap-1">
        <h4 id={headingId} className="m-0 text-base">
          {m.preset_heading()}
        </h4>
        <p className="help m-0">{m.preset_intro()}</p>
      </div>
      {applied && (
        <p className="m-0">
          <strong>{presetLabelText(applied, exceptions?.count ?? 0)}</strong>
          {label?.applied_preset_at && (
            <small className="text-travel-muted">
              {" "}
              {m.preset_label_applied_on({ date: formatInstantDate(label.applied_preset_at) })}
            </small>
          )}
        </p>
      )}
      <ChoiceGroup
        label={m.preset_choose_label()}
        value={value}
        choices={choices}
        onChange={(next) => {
          if (creation) creation.onChange(next === none ? null : (next as SharingPresetId));
          else setChosen(next as SharingPresetId);
        }}
      />
      <p className="help m-0">
        {described
          ? PRESET_DESCRIPTIONS[described]()
          : creation
            ? m.preset_none_help()
            : m.preset_choose_first()}
      </p>
      {creation && described && (
        <p className="help m-0">
          {m.preset_new_link_chosen_help({ preset: presetName(described) })}
        </p>
      )}
      {!creation && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            ref={reviewButton}
            className="secondary"
            type="button"
            disabled={disabled || !!blocked || review.isPending || !target}
            onClick={() => void startReview()}
          >
            {review.isPending ? m.preset_reviewing() : m.preset_review_button()}
          </Button>
          {blocked && preset.dirty && <small className="help">{blocked}</small>}
        </div>
      )}
      {failure && (
        <Alert role="alert" variant="error">
          {failure}
        </Alert>
      )}
      {notice && <Alert role="status">{notice}</Alert>}
      {applied && exceptions && (
        <PresetExceptionsList
          preset={applied}
          exceptions={exceptions}
          scope={scope}
          setScope={setScope}
          catalog={catalog}
          tripId={tripId}
          allowExclusions={allowExclusions}
          dirty={preset.dirty}
          disabled={disabled}
          onError={onError}
        />
      )}
      {open && target && (
        <PresetReviewDialog
          tripId={tripId}
          target={target}
          initial={open}
          revision={preset.revision}
          returnFocus={() => reviewButton.current}
          onClose={() => setOpen(null)}
          onReload={(current) => {
            setOpen(null);
            preset.onReload(current);
          }}
          onApplied={(audience, wasApplied, result) => {
            setOpen(null);
            setChosen("");
            setNotice(
              textNotice(() =>
                wasApplied
                  ? m.preset_applied_done({ preset: presetName(result.preset) })
                  : m.preset_applied_nothing({ preset: presetName(result.preset) }),
              ),
            );
            preset.onApplied(audience);
          }}
        />
      )}
    </section>
  );
}
