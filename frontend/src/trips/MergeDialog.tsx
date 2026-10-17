import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";

import { SearchSelect } from "../forms/fields";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { Area, AreaMergeResult, LocationMergeResult, Trip } from "../tracker-model";
import { Field, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { parseAudience, type DuplicateGroup, type DuplicateReason } from "./merge-candidates";

export type MergeKind = "location" | "area";
/** What the owner asked for: keep one record and fold the others into it. */
export type MergeRequest = { keepId: string; duplicateIds: string[]; token: number };
export type MergeRecord = { id: string; name: string; detail: string; areaId?: string };
type MergeResult = LocationMergeResult | AreaMergeResult;

const REASONS: Record<DuplicateReason, () => string> = {
  name: m.owner_same_name,
  coordinates: m.owner_same_coordinates,
  address: m.owner_same_address,
};
/** The reasons two records look alike, as one phrase. */
export const reasonsText = (reasons: DuplicateReason[]) =>
  reasons.map((reason) => REASONS[reason]()).join(", ");
const audienceText = (names: string[]) =>
  names
    .map((name) => {
      const audience = parseAudience(name);
      return audience.kind === "public"
        ? m.owner_public_page()
        : audience.kind === "link"
          ? m.owner_share_link({ p0: audience.label })
          : audience.name;
    })
    .join(", ");

type MergeProps = {
  trip: Trip;
  kind: MergeKind;
  /** Every location or area of the trip. */
  records: MergeRecord[];
  /** Areas, to name where a location's visits and routes would move. */
  areas?: Area[];
  /** Records that look alike, so likely duplicates are offered first. Suggestions never select anything. */
  suggestions?: DuplicateGroup[];
  request: MergeRequest | null;
  onClose: () => void;
  onMerged: (keepId: string, merged: number) => void;
};

/**
 * Folds duplicate locations or areas into one record: choose what to keep and what to
 * merge, read the server's preview, then confirm. The merge is not reversible, so nothing
 * is applied before that explicit confirmation, and a refusal is shown inside the dialog.
 */
export function MergeDialog({ kind, request, onClose, ...rest }: MergeProps) {
  useLocale();
  const [error, setError] = useFeedback<string | null>(null);
  useEffect(() => setError(null), [request?.token]);
  return (
    <RecordDialog
      open={request !== null}
      title={kind === "location" ? m.owner_merge_locations() : m.owner_merge_areas()}
      error={error}
      onDismiss={onClose}
    >
      {request && (
        <MergeBody
          key={request.token}
          kind={kind}
          request={request}
          onClose={onClose}
          setError={setError}
          {...rest}
        />
      )}
    </RecordDialog>
  );
}

function MergeBody({
  trip,
  kind,
  records,
  areas = [],
  suggestions = [],
  request,
  onClose,
  onMerged,
  setError,
}: Omit<MergeProps, "request"> & {
  request: MergeRequest;
  setError: (notice: ReturnType<typeof errorNotice> | null) => void;
}) {
  useLocale();
  const locations = kind === "location";
  const [keepId, setKeepId] = useState(request.keepId);
  const [picked, setPicked] = useState(request.duplicateIds);
  // The records as they were when previewed: the lists refetch before a merge settles, and the duplicates are gone by then.
  const [previewed, setPreviewed] = useState<{
    result: MergeResult;
    records: MergeRecord[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const path = `${tripPath(trip.id, locations ? "locations" : "areas")}/merge`;
  const body = (confirm: boolean) => ({ keep_id: keepId, duplicate_ids: picked, confirm });
  const previewFailure = locations
    ? m.owner_the_location_merge_could_not_be_previewed
    : m.owner_the_area_merge_could_not_be_previewed;
  const mergeFailure = locations
    ? m.owner_the_locations_could_not_be_merged
    : m.owner_the_areas_could_not_be_merged;
  const check = useOwnerMutation<undefined, MergeResult>({
    fallback: previewFailure,
    request: () => ({ path, method: "POST", body: body(false) }),
    invalidate: () => [],
    gcTime: 0,
  });
  const apply = useOwnerMutation<undefined, MergeResult>({
    fallback: mergeFailure,
    request: () => ({ path, method: "POST", body: body(true) }),
    invalidate: (subject) => [ownerKeys.trip(subject, trip.id), ownerKeys.trips(subject)],
    gcTime: 0,
  });

  const group = suggestions.find((candidate) => candidate.ids.includes(keepId));
  const candidates = records
    .filter((record) => record.id !== keepId)
    .map((record) => ({ record, likely: group?.ids.includes(record.id) ?? false }))
    .sort((a, b) => Number(b.likely) - Number(a.likely));
  const areaLabel = (id: string | undefined) =>
    areas.find((area) => area.id === id)?.label ?? m.owner_unknown_area();

  async function run(confirm: boolean) {
    setError(null);
    try {
      if (confirm) {
        const result = await apply.mutateAsync(undefined);
        onMerged(result.keep_id, result.duplicates.length);
      } else setPreviewed({ result: await check.mutateAsync(undefined), records });
    } catch (failure) {
      setError(errorNotice(failure, confirm ? mergeFailure : previewFailure));
    }
  }

  if (previewed) {
    const { result: preview } = previewed;
    const was = (id: string) => previewed.records.find((record) => record.id === id);
    const nameOf = (id: string) => was(id)?.name ?? "";
    const keepArea = was(preview.keep_id)?.areaId;
    const keptName = nameOf(preview.keep_id);
    const warnings: string[] = [];
    for (const duplicate of preview.duplicates) {
      const name = nameOf(duplicate.id);
      if (duplicate.narrowed_audiences.length)
        warnings.push(
          (locations ? m.owner_merge_location_narrows : m.owner_merge_area_narrows)({
            p0: name,
            p1: audienceText(duplicate.narrowed_audiences),
          }),
        );
      if (
        "area_id" in duplicate &&
        duplicate.area_id !== keepArea &&
        (duplicate.visits > 0 || duplicate.routes > 0)
      )
        warnings.push(m.owner_merge_moves_to_area({ p0: name, p1: areaLabel(keepArea) }));
    }
    if ("city_level_location_ids" in preview && preview.city_level_location_ids.length)
      warnings.push(m.owner_merge_city_level({ count: preview.city_level_location_ids.length }));
    const pending = apply.isPending;
    return (
      <div className="stack-form">
        <h3>{m.owner_what_the_merge_does()}</h3>
        <p>{m.owner_merge_keeps({ p0: keptName })}</p>
        {preview.duplicates.map((duplicate) => (
          <section
            className="grid gap-1 rounded-xl border border-travel-divider bg-travel-surface p-3"
            key={duplicate.id}
            aria-label={nameOf(duplicate.id)}
          >
            <strong>{m.owner_merge_into({ p0: nameOf(duplicate.id) })}</strong>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {"locations" in duplicate && (
                <li>{m.owner_merge_count_locations({ p0: duplicate.locations })}</li>
              )}
              <li>{m.owner_merge_count_visits({ p0: duplicate.visits })}</li>
              {"stays" in duplicate && (
                <li>{m.owner_merge_count_stays({ p0: duplicate.stays })}</li>
              )}
              <li>{m.owner_merge_count_routes({ p0: duplicate.routes })}</li>
              <li>{m.owner_merge_count_travel_updates({ p0: duplicate.travel_updates })}</li>
            </ul>
          </section>
        ))}
        {warnings.length ? (
          <ul className="m-0 grid gap-1.5 pl-5" aria-label={m.owner_merge_warnings()}>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p className="help">{m.owner_merge_no_warnings()}</p>
        )}
        <p>
          {locations
            ? m.owner_merge_location_cannot_be_undone()
            : m.owner_merge_area_cannot_be_undone()}
        </p>
        <div className="button-row">
          <Button
            className="danger"
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            {pending ? m.owner_merging() : m.owner_merge()}
          </Button>
          <Button
            className="secondary"
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setPreviewed(null);
            }}
          >
            {m.owner_back()}
          </Button>
          <Button className="secondary" type="button" disabled={pending} onClick={onClose}>
            {m.owner_cancel()}
          </Button>
        </div>
        {confirming && (
          <DeleteConfirmation
            title={locations ? m.owner_merge_locations_question() : m.owner_merge_areas_question()}
            description={m.owner_merge_confirmation({ p0: keptName })}
            confirmLabel={m.owner_merge_for_good()}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void run(true);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(false);
      }}
    >
      <p className="help">
        {locations ? m.owner_merge_location_intro() : m.owner_merge_area_intro()}
      </p>
      <Field>
        <FieldLabel>{locations ? m.owner_location_to_keep() : m.owner_area_to_keep()}</FieldLabel>
        <SearchSelect
          ariaLabel={locations ? m.owner_location_to_keep() : m.owner_area_to_keep()}
          value={keepId}
          onChange={(id) => {
            setKeepId(id);
            setPicked((current) => current.filter((candidate) => candidate !== id));
          }}
        >
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {[record.name, record.detail].filter(Boolean).join(" · ")}
            </option>
          ))}
        </SearchSelect>
      </Field>
      <FieldSet className="grid gap-2">
        <FieldLegend>
          {locations ? m.owner_duplicate_locations_to_merge() : m.owner_duplicate_areas_to_merge()}
        </FieldLegend>
        {candidates.length === 0 && <p className="help">{m.owner_nothing_else_to_merge()}</p>}
        {candidates.map(({ record, likely }) => (
          <Field className="contents" key={record.id}>
            <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
              <TravelCheckbox
                checked={picked.includes(record.id)}
                onCheckedChange={(checked) =>
                  setPicked((current) =>
                    checked
                      ? [...current, record.id]
                      : current.filter((candidate) => candidate !== record.id),
                  )
                }
              />
              <span className="grid">
                <span>{record.name}</span>
                {(record.detail || likely) && (
                  <span className="text-sm font-normal">
                    {[
                      record.detail,
                      likely && group
                        ? m.owner_probably_the_same({ p0: reasonsText(group.reasons) })
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
            </FieldLabel>
          </Field>
        ))}
      </FieldSet>
      <div className="button-row">
        <Button type="submit" disabled={!picked.length || check.isPending}>
          {check.isPending ? m.owner_loading_preview() : m.owner_preview_merge()}
        </Button>
        <Button className="secondary" type="button" onClick={onClose}>
          {m.owner_cancel()}
        </Button>
      </div>
    </form>
  );
}

export const mergedNotice = (kind: MergeKind, merged: number) =>
  textNotice(() =>
    (kind === "location" ? m.owner_locations_merged : m.owner_areas_merged)({ count: merged }),
  );
