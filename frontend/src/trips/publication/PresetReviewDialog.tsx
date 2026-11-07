import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useState, type ReactNode } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { descriptorMessage } from "../../query/error-messages";
import { DeleteConfirmation } from "../../RecordDialog";
import type {
  DatePrecision,
  KindCounts,
  PresetRecordRef,
  ShareScopeKind,
  SharingPresetReview,
} from "../../tracker-model";
import { GROUP_TITLES, kindCountsText } from "./catalog";
import {
  presetName,
  presetRefusal,
  usePresetMutations,
  type PresetAppliedAudience,
  type PresetTarget,
} from "./use-sharing-presets";

const PRECISION_NAMES: Record<DatePrecision, () => string> = {
  day: () => m.precision_audience_day().toLowerCase(),
  month: () => m.precision_audience_month().toLowerCase(),
  year: () => m.precision_audience_year().toLowerCase(),
};
const precisionName = (value: DatePrecision | null) =>
  value ? PRECISION_NAMES[value]() : m.preset_review_precision_none();

const LEFT_AS_IS: Record<string, () => string> = {
  "outside_preset/unlist": () => m.preset_review_left_unlist(),
  "outside_preset/exclude": () => m.preset_review_left_exclude(),
  "everyone_on_public_view/change_visibility": () => m.preset_review_left_public(),
  "needed_by_included_records/change_visibility": () => m.preset_review_left_needed(),
};
const REPLACES: Record<string, () => string> = {
  exclusion_removed: () => m.preset_review_replaces_exclusion_removed(),
  left_out_by_you: () => m.preset_review_replaces_left_out_by_you(),
};

/** The records of a review, grouped by kind, folded away when there are many so a long plan stays a short dialog. */
function RecordList({
  heading,
  records,
  note,
}: {
  heading: ReactNode;
  records: PresetRecordRef[];
  note?: (record: PresetRecordRef) => string | null;
}) {
  useLocale();
  const groups = new Map<ShareScopeKind, PresetRecordRef[]>();
  for (const record of records)
    groups.set(record.kind, [...(groups.get(record.kind) ?? []), record]);
  return (
    <Collapsible.Root className="scope-group" data-disclosure="" defaultOpen={records.length <= 6}>
      <Collapsible.Trigger className="max-sm:flex-wrap max-sm:justify-start max-sm:[&>strong]:basis-3/4 max-sm:[&>span]:basis-full max-sm:[&>span]:pl-6">
        <strong>{heading}</strong>
        <span>{m.preset_review_records({ count: records.length })}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-2 px-3.25 pt-0 pb-3.25">
        {[...groups].map(([kind, group]) => (
          <div key={kind} className="grid gap-1">
            <strong className="text-sm">{GROUP_TITLES[kind]}</strong>
            <ul className="m-0 grid gap-0.5 pl-5">
              {group.map((record) => (
                <li key={record.id}>
                  {record.label || m.preset_exception_untitled()}
                  {note?.(record) && <small className="text-travel-muted"> · {note(record)}</small>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const audienceName = (review: SharingPresetReview) =>
  review.audience.kind === "public"
    ? m.preset_review_audience_public()
    : review.audience.kind === "link"
      ? m.preset_review_audience_link({ label: review.audience.label ?? "" })
      : m.preset_review_audience_member({ label: review.audience.label ?? "" });

type Problem = "stale" | "conflict" | "other";

/**
 * The read-only review of a preset before it applies: what the audience starts and stops receiving, what its dates
 * become, which choices made by hand it resets, and what is left as it is. A live audience that would see more needs
 * the same explicit acknowledgement as every other widening. Nothing is stored until the owner applies it, and the
 * apply carries the review's fingerprint, so a plan that changed in the meantime is shown again instead of applied.
 */
export function PresetReviewDialog({
  tripId,
  target,
  initial,
  revision,
  returnFocus,
  onClose,
  onApplied,
  onReload,
}: {
  tripId: string;
  target: PresetTarget;
  initial: SharingPresetReview;
  /** Read when the owner applies, so a revision claimed since the dialog opened is never used. */
  revision: () => number;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onApplied: (
    audience: PresetAppliedAudience,
    applied: boolean,
    review: SharingPresetReview,
  ) => void;
  /** The audience changed elsewhere: load the current record the server sent. */
  onReload: (current: PresetAppliedAudience) => void;
}) {
  useLocale();
  const { apply } = usePresetMutations(tripId);
  const [review, setReview] = useState(initial);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState<{
    kind: Problem;
    error?: unknown;
    current?: PresetAppliedAudience;
  } | null>(null);

  const comparison = review.comparison;
  const added = (comparison?.added ?? {}) as KindCounts;
  const removed = (comparison?.removed ?? {}) as KindCounts;
  const addedText = kindCountsText(added);
  const removedText = kindCountsText(removed);
  const coarserText = kindCountsText({
    visit: review.precision.reads_coarser.visit,
    stay: review.precision.reads_coarser.stay,
    travel_update: review.precision.reads_coarser.travel_update,
  });
  const nothing =
    review.applicable &&
    !review.changes.length &&
    !review.precision.changed &&
    !review.replaces_exceptions.length;
  const needsAcknowledgement = review.requires_acknowledgement;
  const pending = apply.isPending;

  const leftGroups = new Map<string, typeof review.left_as_is>();
  for (const record of review.left_as_is) {
    const key = `${record.reason}/${record.way_out}`;
    leftGroups.set(key, [...(leftGroups.get(key) ?? []), record]);
  }

  async function confirm() {
    setProblem(null);
    try {
      const result = await apply.mutateAsync({
        target,
        preset: review.preset,
        fingerprint: review.fingerprint,
        confirmWidening: needsAcknowledgement && acknowledged,
        revision: revision(),
      });
      onApplied(result.audience, result.applied, result.review);
    } catch (error) {
      const stale = presetRefusal<{ code: string; review: SharingPresetReview }>(
        error,
        409,
        "preset_preview_is_stale",
      );
      const tooLarge = presetRefusal<{
        code: string;
        items: number;
        exclude: number;
        max_items: number;
        max_exclude: number;
      }>(error, 409, "preset_too_large");
      const widening = presetRefusal<{ code: string }>(
        error,
        409,
        "preset_widening_needs_acknowledgement",
      );
      const conflict = presetRefusal<{ code: string; current?: PresetAppliedAudience }>(
        error,
        412,
        "scope_revision_conflict",
      );
      if (stale) {
        // The records changed since the review: show the fresh one and ask again, with the acknowledgement reset.
        setReview(stale.review);
        setAcknowledged(false);
        setProblem({ kind: "stale" });
      } else if (tooLarge) {
        setReview({
          ...review,
          applicable: false,
          comparison: null,
          refusal: { ...tooLarge, code: "preset_too_large" },
        });
        setProblem(null);
      } else if (widening) {
        setReview({ ...review, requires_acknowledgement: true });
        setAcknowledged(false);
      } else if (conflict?.current) {
        setProblem({ kind: "conflict", current: conflict.current });
      } else {
        setProblem({ kind: "other", error });
      }
    }
  }

  return (
    <DeleteConfirmation
      wide
      confirmTone={needsAcknowledgement ? "danger" : "primary"}
      title={m.preset_review_title({ preset: presetName(review.preset) })}
      description={m.preset_review_description({ audience: audienceName(review) })}
      confirmLabel={pending ? m.preset_review_applying() : m.preset_review_apply()}
      confirmDisabled={
        pending ||
        !review.applicable ||
        problem?.kind === "conflict" ||
        (needsAcknowledgement && !acknowledged)
      }
      returnFocus={returnFocus}
      onCancel={() => !pending && onClose()}
      onConfirm={() => void confirm()}
    >
      <div className="grid gap-3" aria-busy={pending}>
        <p className="m-0 text-sm">
          {review.audience.live ? m.preset_review_live() : m.preset_review_draft()}
        </p>
        {problem?.kind === "stale" && (
          <Alert role="alert" variant="error">
            {m.preset_review_stale()}
          </Alert>
        )}
        {problem?.kind === "other" && (
          <Alert role="alert" variant="error">
            {errorMessage(problem.error, m.preset_apply_failed)}
          </Alert>
        )}
        {problem?.kind === "conflict" && (
          <Alert role="alert" variant="error" className="grid gap-2">
            <span>{m.preset_review_conflict()}</span>
            <Button
              type="button"
              className="secondary compact justify-self-start"
              onClick={() => {
                const current = problem.current;
                onClose();
                if (current) onReload(current);
              }}
            >
              {m.preset_review_reload()}
            </Button>
          </Alert>
        )}
        {!review.applicable && review.refusal && (
          <Alert role="alert" variant="error">
            {m.preset_review_too_large({
              items: review.refusal.items,
              exclude: review.refusal.exclude,
              max_items: review.refusal.max_items,
              max_exclude: review.refusal.max_exclude,
            })}
          </Alert>
        )}
        {!review.applicable && !review.refusal && <p>{m.preset_review_not_applicable()}</p>}
        {nothing && <p className="m-0">{m.preset_review_nothing()}</p>}
        {review.applicable && !!comparison?.widened.length && (
          <RecordList
            heading={m.preset_review_adds({ counts: addedText })}
            records={comparison.widened}
          />
        )}
        {review.applicable && !!comparison?.narrowed.length && (
          <RecordList
            heading={m.preset_review_removes({ counts: removedText })}
            records={comparison.narrowed}
          />
        )}
        {review.applicable && (
          <p className="m-0 text-sm">
            {review.precision.changed
              ? m.preset_review_precision_changed({
                  before: precisionName(review.precision.before),
                  after: precisionName(review.precision.after),
                })
              : m.preset_review_precision_same({ after: precisionName(review.precision.after) })}
            {coarserText && <> {m.preset_review_reads_coarser({ counts: coarserText })}</>}
          </p>
        )}
        {review.applicable && !!review.replaces_exceptions.length && (
          <RecordList
            heading={m.preset_review_replaces_heading()}
            records={review.replaces_exceptions}
            note={(record) =>
              REPLACES[(record as (typeof review.replaces_exceptions)[number]).reason]?.() ?? null
            }
          />
        )}
        {[...leftGroups].map(([key, records]) => (
          <div key={key} className="grid gap-1.5">
            <RecordList heading={m.preset_review_left_heading()} records={records} />
            <p className="help m-0">
              {(LEFT_AS_IS[key] ?? LEFT_AS_IS["outside_preset/exclude"])!()}
            </p>
          </div>
        ))}
        {!!review.needs_decision.length && (
          <RecordList
            heading={m.preset_review_decision_heading()}
            records={review.needs_decision}
            note={(record) => {
              const reason = (record as (typeof review.needs_decision)[number]).reason;
              return reason === "share_time_is_on"
                ? m.preset_review_decision_share_time()
                : (descriptorMessage({ code: reason, params: {}, path: [] }) ??
                    m.preset_review_decision_other());
            }}
          />
        )}
        {needsAcknowledgement && (
          <>
            <p className="m-0 font-semibold text-travel-review-warning" role="alert">
              {m.preset_review_widening({ counts: addedText })}
            </p>
            <Field>
              <FieldLabel className="flex items-center gap-2 font-semibold">
                <TravelCheckbox checked={acknowledged} onCheckedChange={setAcknowledged} />
                <span>{m.preset_review_acknowledge()}</span>
              </FieldLabel>
            </Field>
          </>
        )}
      </div>
    </DeleteConfirmation>
  );
}
