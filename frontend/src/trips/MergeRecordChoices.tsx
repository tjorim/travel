import { useId } from "react";

import { formatDateInput } from "../date-input";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { MergeRecordKind, MergeRecordRef, MergeWidenedRecord } from "../tracker-model";
import { Field, FieldLabel, FieldSet, FieldLegend } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { audienceName } from "./locations/model";

/** The identity of a moved record: ids are only unique within a kind. */
export const recordKey = (record: MergeRecordRef) => `${record.kind}:${record.id}`;

const KINDS: {
  kind: MergeRecordKind;
  name: () => string;
  count: (count: number) => string;
}[] = [
  {
    kind: "stay",
    name: m.owner_merge_record_stay,
    count: (count) => m.owner_merge_widening_stays({ count }),
  },
  {
    kind: "visit",
    name: m.owner_merge_record_visit,
    count: (count) => m.owner_merge_widening_visits({ count }),
  },
  {
    kind: "route",
    name: m.owner_merge_record_route,
    count: (count) => m.owner_merge_widening_routes({ count }),
  },
  {
    kind: "travel_update",
    name: m.owner_merge_record_travel_update,
    count: (count) => m.owner_merge_widening_travel_updates({ count }),
  },
];

const audiences = (list: MergeWidenedRecord["widened_for"]) =>
  list.map((audience) => audienceName({ id: audience.audience, label: audience.label })).join(", ");

type Props = {
  records: MergeWidenedRecord[];
  chosen: ReadonlySet<string>;
  disabled?: boolean;
  onChoose: (record: MergeWidenedRecord, checked: boolean) => void;
};

/**
 * The stays, visits, routes and updates a merge would newly show to an audience, grouped by
 * kind. Each is its own explicit choice: following the merge as it is (unticked) or being made
 * private first. The checkbox names say what ticking costs, so hiding is never a side effect.
 */
export function MergeRecordChoices({ records, chosen, disabled, onChoose }: Props) {
  useLocale();
  return (
    <div className="grid gap-3">
      {KINDS.map(({ kind, name, count }) => {
        const group = records.filter((record) => record.kind === kind);
        if (group.length === 0) return null;
        return (
          <FieldSet className="grid min-w-0 gap-1.5" key={kind}>
            <FieldLegend className="font-semibold">
              {m.owner_merge_make_private_group({ p0: count(group.length) })}
            </FieldLegend>
            <ul className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto p-0 pr-1">
              {group.map((record) => (
                <li key={recordKey(record)} className="min-w-0">
                  <RecordChoice
                    record={record}
                    kindName={name()}
                    checked={chosen.has(recordKey(record))}
                    disabled={disabled}
                    onChoose={onChoose}
                  />
                </li>
              ))}
            </ul>
          </FieldSet>
        );
      })}
    </div>
  );
}

function RecordChoice({
  record,
  kindName,
  checked,
  disabled,
  onChoose,
}: {
  record: MergeWidenedRecord;
  kindName: string;
  checked: boolean;
  disabled?: boolean;
  onChoose: Props["onChoose"];
}) {
  const locale = useLocale();
  const detailsId = useId();
  const title = [
    record.label ?? kindName,
    record.starts_on ? formatDateInput(record.starts_on, locale) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Field className="contents">
      <FieldLabel className="flex items-start gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
        <TravelCheckbox
          className="mt-0.5 shrink-0"
          aria-label={m.owner_merge_make_private_record({ p0: title })}
          aria-describedby={detailsId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChoose(record, next)}
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="wrap-anywhere">{title}</span>
          <span id={detailsId} className="grid gap-0.5 text-sm font-normal wrap-anywhere">
            <span>{m.owner_merge_record_newly_shown({ p0: audiences(record.widened_for) })}</span>
            {record.hides_from.length > 0 && (
              <span>{m.owner_merge_record_hides_from({ p0: audiences(record.hides_from) })}</span>
            )}
            {record.custom_picks > 0 && (
              <span>{m.owner_merge_record_custom_picks({ count: record.custom_picks })}</span>
            )}
          </span>
        </span>
      </FieldLabel>
    </Field>
  );
}
