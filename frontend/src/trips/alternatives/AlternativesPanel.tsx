import { Button } from "@/ui/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useEffect, useId, useMemo, useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { DeleteConfirmation, RecordDialog } from "../../RecordDialog";
import { formatDay } from "../../dates";
import {
  type AlternativeGroup,
  type AlternativeKind,
  type AlternativeSuggestion,
} from "../../api-types";
import {
  groupedIds,
  groupTitle,
  membersOf,
  recordDetail,
  recordTitle,
  type AlternativeRecord,
} from "./model";
import { CompareTable } from "./CompareTable";
import { useAlternativeMutations, useAlternativeQueries } from "./use-alternatives";

type Others = "cancel" | "remove";
type Notice = { text: string; undo?: { groupId: string; eventId: string } } | { text: string };

const REASONS: Record<AlternativeSuggestion["reason"], () => string> = {
  overlapping_nights: () => m.owner_alternatives_reason_nights(),
  overlapping_days: () => m.owner_alternatives_reason_days(),
  same_journey: () => m.owner_alternatives_reason_journey(),
};

/**
 * The owner's alternative groups of one kind and the groups the app suggests from loose ideas.
 * A suggestion is stored only when the owner confirms it. Groups are private planning state.
 */
export function AlternativesPanel({
  tripId,
  kind,
  records,
  onOpen,
}: {
  tripId: string;
  kind: AlternativeKind;
  /** Every record of this kind on the trip, to name members and to offer loose ones for a new group. */
  records: AlternativeRecord[];
  onOpen: (id: string) => void;
}) {
  useLocale();
  const { groups: groupsQuery, suggestions: suggestionsQuery } = useAlternativeQueries(tripId);
  const { create, update, dissolve, choose, undo } = useAlternativeMutations(tripId, kind);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<{ group: AlternativeGroup; id: string } | null>(null);
  const [others, setOthers] = useState<Others>("cancel");
  const [comparing, setComparing] = useState<AlternativeGroup | null>(null);
  const [editing, setEditing] = useState<AlternativeGroup | "new" | null>(null);
  const [dissolving, setDissolving] = useState<AlternativeGroup | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);

  // After a choice the dialog closes and its trigger may be a disabled button: land on the group instead.
  useEffect(() => {
    if (!focusGroup) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`alternative-group-${focusGroup}`)?.focus();
      setFocusGroup(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusGroup]);

  const groups = (groupsQuery.data ?? []).filter((group) => group.kind === kind);
  const suggestions = (suggestionsQuery.data ?? []).filter((item) => item.kind === kind);
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const loose = records.filter((record) => !groupedIds(groups).has(record.id));
  const failed = groupsQuery.error ?? suggestionsQuery.error;

  if (!failed && !groups.length && !suggestions.length && loose.length < 2) return null;

  const names = (ids: string[]) =>
    ids.map((id) => (byId.get(id) ? recordTitle(kind, byId.get(id)!) : "")).filter(Boolean);

  async function confirmSuggestion(suggestion: AlternativeSuggestion) {
    setError(null);
    try {
      const group = await create.mutateAsync({ memberIds: suggestion.member_ids });
      setNotice({ text: m.owner_alternatives_grouped() });
      setFocusGroup(group.id);
    } catch (problem) {
      setError(errorMessage(problem, m.owner_the_alternatives_could_not_be_saved));
    }
  }

  async function confirmChoice() {
    if (!choosing) return;
    const { group, id } = choosing;
    const name = recordTitle(kind, byId.get(id)!);
    setError(null);
    try {
      const result = await choose.mutateAsync({ id: group.id, memberId: id, others });
      setChoosing(null);
      setNotice({
        text:
          others === "remove"
            ? m.owner_alternatives_chosen_removed({ name })
            : m.owner_alternatives_chosen_cancelled({ name }),
        ...(result.undoable ? { undo: { groupId: group.id, eventId: result.event_id } } : {}),
      });
      setFocusGroup(group.id);
    } catch (problem) {
      setChoosing(null);
      setError(errorMessage(problem, m.owner_the_choice_could_not_be_made));
    }
  }

  async function undoChoice(groupId: string, eventId: string) {
    setError(null);
    try {
      await undo.mutateAsync({ id: groupId, eventId });
      setNotice({ text: m.owner_alternatives_undone() });
      setFocusGroup(groupId);
    } catch (problem) {
      setNotice(null);
      setError(errorMessage(problem, m.owner_the_choice_could_not_be_undone));
    }
  }

  async function confirmDissolve() {
    if (!dissolving) return;
    const group = dissolving;
    setError(null);
    try {
      await dissolve.mutateAsync(group);
      setDissolving(null);
      setNotice({ text: m.owner_alternatives_dissolved() });
    } catch (problem) {
      setDissolving(null);
      setError(errorMessage(problem, m.owner_the_group_could_not_be_dissolved));
    }
  }

  const busy = choose.isPending || undo.isPending || create.isPending || dissolve.isPending;
  const choosingName = choosing ? recordTitle(kind, byId.get(choosing.id)!) : "";

  return (
    <section className="grid gap-2" aria-labelledby={`alternatives-${kind}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`alternatives-${kind}-title`} className="m-0">
          {m.owner_alternatives_heading()}
        </h4>
        {loose.length >= 2 && (
          <Button
            className="secondary compact"
            type="button"
            disabled={busy}
            onClick={() => setEditing("new")}
          >
            {m.owner_alternatives_new_group()}
          </Button>
        )}
      </div>
      <p className="help">{m.owner_alternatives_help()}</p>
      {failed && (
        <p role="alert">{errorMessage(failed, m.owner_your_alternatives_could_not_be_loaded)}</p>
      )}
      <div role="status" className="grid gap-1 empty:hidden">
        {notice && (
          <p className="m-0 flex flex-wrap items-center gap-2">
            <span>{notice.text}</span>
            {"undo" in notice && notice.undo && (
              <Button
                className="secondary compact"
                type="button"
                disabled={busy}
                onClick={() => void undoChoice(notice.undo!.groupId, notice.undo!.eventId)}
              >
                {m.owner_alternatives_undo()}
              </Button>
            )}
          </p>
        )}
      </div>
      {error && (
        <p className="form-error m-0" role="alert">
          {error}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul
          className="m-0 grid list-none gap-2 p-0"
          aria-label={m.owner_alternatives_suggestions()}
        >
          {suggestions.map((suggestion) => {
            const listed = names(suggestion.member_ids);
            const dates = spanText(suggestion);
            return (
              <li
                key={suggestion.member_ids.join("|")}
                className="grid gap-1 rounded-xl border border-dashed border-travel-border p-2.5"
              >
                <strong>{[REASONS[suggestion.reason](), dates].filter(Boolean).join(" · ")}</strong>
                <span className="wrap-anywhere">{listed.join(" · ")}</span>
                <div className="button-row">
                  <Button
                    className="secondary compact"
                    type="button"
                    disabled={busy}
                    aria-label={m.owner_alternatives_group_these_label({
                      names: listed.join(", "),
                    })}
                    onClick={() => void confirmSuggestion(suggestion)}
                  >
                    {m.owner_alternatives_group_these()}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {groups.map((group) => {
        const members = membersOf(group);
        const title = groupTitle(group);
        const chosen = members.find((member) => member.chosen);
        return (
          <div
            key={group.id}
            id={`alternative-group-${group.id}`}
            role="group"
            aria-label={title}
            tabIndex={-1}
            className="grid gap-2 border-l-2 border-travel-border pl-2 outline-offset-4"
          >
            <p className="m-0 font-bold">{title}</p>
            <p className="help m-0">
              {chosen
                ? m.owner_alternatives_chosen({ name: recordTitle(kind, chosen.record) })
                : m.owner_alternatives_undecided()}
            </p>
            {members.map((member) => {
              const name = recordTitle(kind, member.record);
              return (
                <article className="excerpt-row" key={member.id} data-stacked="">
                  <Button
                    className="document-select"
                    type="button"
                    onClick={() => onOpen(member.id)}
                  >
                    <strong>{name}</strong>
                    <span>{recordDetail(kind, member.record)}</span>
                  </Button>
                  <div className="button-row">
                    <Button
                      className="secondary compact"
                      type="button"
                      disabled={busy || member.chosen}
                      aria-label={
                        member.chosen ? undefined : m.owner_alternatives_choose_label({ name })
                      }
                      onClick={() => {
                        setOthers("cancel");
                        setChoosing({ group, id: member.id });
                      }}
                    >
                      {member.chosen
                        ? m.owner_alternatives_is_chosen()
                        : m.owner_alternatives_choose()}
                    </Button>
                  </div>
                </article>
              );
            })}
            <div className="button-row">
              <Button
                className="secondary compact"
                type="button"
                onClick={() => setComparing(group)}
              >
                {m.owner_alternatives_compare()}
              </Button>
              <Button className="secondary compact" type="button" onClick={() => setEditing(group)}>
                {m.owner_alternatives_edit_members()}
              </Button>
              <Button
                className="secondary compact"
                type="button"
                disabled={busy}
                onClick={() => setDissolving(group)}
              >
                {m.owner_alternatives_dissolve()}
              </Button>
            </div>
          </div>
        );
      })}
      {choosing && (
        <DeleteConfirmation
          title={m.owner_alternatives_choose_title({ name: choosingName })}
          description={m.owner_alternatives_choose_description({ name: choosingName })}
          confirmLabel={m.owner_alternatives_choose()}
          confirmDisabled={choose.isPending}
          onCancel={() => setChoosing(null)}
          onConfirm={() => void confirmChoice()}
        >
          <ChoiceGroup<Others>
            label={m.owner_alternatives_others_label()}
            value={others}
            choices={[
              { value: "cancel", label: m.owner_alternatives_others_cancel() },
              { value: "remove", label: m.owner_alternatives_others_remove() },
            ]}
            onChange={setOthers}
          />
          <p className="help m-0">
            {others === "remove"
              ? m.owner_alternatives_remove_warning()
              : m.owner_alternatives_cancel_note()}
          </p>
        </DeleteConfirmation>
      )}
      {dissolving && (
        <DeleteConfirmation
          title={m.owner_alternatives_dissolve_title()}
          description={m.owner_alternatives_dissolve_description()}
          confirmLabel={m.owner_alternatives_dissolve()}
          confirmDisabled={dissolve.isPending}
          onCancel={() => setDissolving(null)}
          onConfirm={() => void confirmDissolve()}
        />
      )}
      <RecordDialog
        open={comparing !== null}
        title={m.owner_alternatives_compare_title()}
        localeControl={false}
        onDismiss={() => setComparing(null)}
      >
        {comparing && <CompareTable kind={kind} group={comparing} />}
      </RecordDialog>
      {editing && (
        <MembersDialog
          kind={kind}
          group={editing === "new" ? null : editing}
          records={records}
          loose={loose}
          pending={create.isPending || update.isPending}
          onDismiss={() => setEditing(null)}
          onSave={async (ids) => {
            setError(null);
            try {
              if (editing === "new") {
                const group = await create.mutateAsync({ memberIds: ids });
                setNotice({ text: m.owner_alternatives_grouped() });
                setFocusGroup(group.id);
              } else {
                const current = editing.members.map((member) => member.record_id);
                await update.mutateAsync({
                  id: editing.id,
                  add: ids.filter((id) => !current.includes(id)),
                  remove: current.filter((id) => !ids.includes(id)),
                });
                setNotice({ text: m.owner_alternatives_members_saved() });
                setFocusGroup(editing.id);
              }
              setEditing(null);
            } catch (problem) {
              setEditing(null);
              setError(errorMessage(problem, m.owner_the_alternatives_could_not_be_saved));
            }
          }}
        />
      )}
    </section>
  );
}

function spanText(suggestion: AlternativeSuggestion): string {
  const { starts_on: first, ends_on: last } = suggestion;
  if (!first) return "";
  return !last || last === first ? formatDay(first) : `${formatDay(first)} → ${formatDay(last)}`;
}

/** Choose which records are alternatives of each other: the group's own and the loose ones. */
function MembersDialog({
  kind,
  group,
  records,
  loose,
  pending,
  onDismiss,
  onSave,
}: {
  kind: AlternativeKind;
  group: AlternativeGroup | null;
  records: AlternativeRecord[];
  loose: AlternativeRecord[];
  pending: boolean;
  onDismiss: () => void;
  onSave: (ids: string[]) => void | Promise<void>;
}) {
  useLocale();
  const own = useMemo(
    () => (group ? group.members.map((member) => member.record_id) : []),
    [group],
  );
  const [picked, setPicked] = useState<string[]>(own);
  const legendId = useId();
  const choices = [
    ...records.filter((record) => own.includes(record.id)),
    ...loose.filter((record) => !own.includes(record.id)),
  ];
  const changed = picked.length !== own.length || picked.some((id) => !own.includes(id));
  return (
    <RecordDialog
      open
      title={group ? m.owner_alternatives_edit_members() : m.owner_alternatives_new_group()}
      localeControl={false}
      dirty={changed}
      onDismiss={onDismiss}
    >
      <FieldSet className="grid gap-2">
        <FieldLegend id={legendId} className="font-semibold">
          {m.owner_alternatives_pick_members()}
        </FieldLegend>
        <ul className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto p-0 pr-1">
          {choices.map((record) => (
            <li key={record.id} className="min-w-0">
              <Field className="contents">
                <FieldLabel className="flex items-start gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
                  <TravelCheckbox
                    className="mt-0.5 shrink-0"
                    aria-label={recordTitle(kind, record)}
                    checked={picked.includes(record.id)}
                    onCheckedChange={(next) =>
                      setPicked((current) =>
                        next ? [...current, record.id] : current.filter((id) => id !== record.id),
                      )
                    }
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="wrap-anywhere">{recordTitle(kind, record)}</span>
                    <span className="text-sm font-normal wrap-anywhere">
                      {recordDetail(kind, record)}
                    </span>
                  </span>
                </FieldLabel>
              </Field>
            </li>
          ))}
        </ul>
        {!group && picked.length < 2 && (
          <p className="help m-0">{m.owner_alternatives_pick_two()}</p>
        )}
        <div className="button-row">
          <Button
            className="compact"
            type="button"
            disabled={pending || !changed || (!group && picked.length < 2)}
            onClick={() => void onSave(picked)}
          >
            {m.owner_alternatives_save_members()}
          </Button>
        </div>
      </FieldSet>
    </RecordDialog>
  );
}
