import { Button } from "@/ui/button";
import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { PresetExceptions, PresetRecordRef, ShareScope } from "../../tracker-model";
import { useSetVisibility } from "../visibility";
import { GROUP_TITLES, isExcluded, setShown, updateItem, type CatalogItem } from "./catalog";
import { presetName } from "./use-sharing-presets";

type Action = "show" | "hide" | "pending" | "way_out" | null;

/**
 * What an audience receives differently from the preset it last applied, as the server counts it, with the controls
 * that already exist for each record: tick it for this audience (promoting a private one first), untick it, or leave it
 * out of a hidden link. Nothing is written here beyond what those controls write; the scope changes in the editor and
 * is saved with its Save button.
 */
export function PresetExceptionsList({
  preset,
  exceptions,
  scope,
  setScope,
  catalog,
  tripId,
  allowExclusions,
  dirty,
  disabled,
  onError,
}: {
  preset: string;
  exceptions: PresetExceptions;
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  catalog: CatalogItem[];
  tripId: string;
  allowExclusions: boolean;
  /** Unsaved edits: the counts still describe the saved audience. */
  dirty: boolean;
  disabled: boolean;
  onError: (error: unknown) => void;
}) {
  useLocale();
  const setVisibility = useSetVisibility(tripId);
  const [busy, setBusy] = useState(false);
  const find = (record: PresetRecordRef) =>
    catalog.find((item) => item.kind === record.kind && item.id === record.id);
  const listed = (item: CatalogItem) =>
    scope.items.some((value) => value.kind === item.kind && value.id === item.id);

  /** Whether the audience would receive the record if the draft were saved. */
  const receivedInDraft = (item: CatalogItem) =>
    !isExcluded(scope, item) && (item.visibility === "everyone" || listed(item));

  function actionFor(mode: "shown" | "hidden", record: PresetRecordRef): Action {
    const item = find(record);
    if (!item) return null;
    if (mode === "hidden") {
      if (receivedInDraft(item)) return dirty ? "pending" : null;
      return "show";
    }
    if (listed(item)) return "hide";
    if (item.visibility === "everyone")
      return allowExclusions ? (isExcluded(scope, item) ? "pending" : "hide") : "way_out";
    return dirty ? "pending" : null;
  }

  async function show(item: CatalogItem) {
    if (isExcluded(scope, item)) {
      setScope(setShown(scope, item, true));
      return;
    }
    if (item.visibility === "private") {
      setBusy(true);
      try {
        // The same promotion the "Records for this audience only" lists make before they list a private record.
        await setVisibility.mutateAsync({ kind: item.kind, id: item.id, visibility: "custom" });
      } catch (error) {
        onError(error);
        return;
      } finally {
        setBusy(false);
      }
    }
    setScope(updateItem(scope, item, true));
  }

  function hide(item: CatalogItem) {
    setScope(listed(item) ? updateItem(scope, item, false) : setShown(scope, item, false));
  }

  function row(record: PresetRecordRef, mode: "shown" | "hidden") {
    const item = find(record);
    const name = record.label || item?.label || m.preset_exception_untitled();
    const action = actionFor(mode, record);
    return (
      <li
        key={`${record.kind}-${record.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="min-w-0 flex-1 wrap-anywhere">
          <strong>{name}</strong>{" "}
          <small className="text-travel-muted">{GROUP_TITLES[record.kind]}</small>
          {action === "way_out" && (
            <small className="block text-travel-muted">
              {m.preset_exception_way_out_everyone()}
            </small>
          )}
        </span>
        {action === "pending" && (
          <small className="text-travel-muted" role="status">
            {m.preset_exception_unsaved()}
          </small>
        )}
        {(action === "show" || action === "hide") && item && (
          <Button
            className="secondary compact"
            type="button"
            disabled={disabled || busy}
            aria-label={
              action === "show"
                ? m.preset_exception_show_named({ name })
                : m.preset_exception_hide_named({ name })
            }
            onClick={() => (action === "show" ? void show(item) : hide(item))}
          >
            {action === "show" ? m.preset_exception_show() : m.preset_exception_hide()}
          </Button>
        )}
      </li>
    );
  }

  return (
    <section className="grid gap-2.5" aria-label={m.preset_exceptions_heading()}>
      <div className="grid gap-1">
        <h4 className="m-0 text-base">{m.preset_exceptions_heading()}</h4>
        <p className="help m-0">{m.preset_exceptions_intro({ preset: presetName(preset) })}</p>
      </div>
      {exceptions.count === 0 && <p className="help m-0">{m.preset_exceptions_none()}</p>}
      {dirty && exceptions.count > 0 && <p className="help m-0">{m.preset_exceptions_unsaved()}</p>}
      {!!exceptions.shown.length && (
        <div className="grid gap-1.5">
          <h5 className="m-0 text-sm">
            {m.preset_exceptions_received({ count: exceptions.shown.length })}
          </h5>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {exceptions.shown.map((record) => row(record, "shown"))}
          </ul>
        </div>
      )}
      {!!exceptions.hidden.length && (
        <div className="grid gap-1.5">
          <h5 className="m-0 text-sm">
            {m.preset_exceptions_missing({ count: exceptions.hidden.length })}
          </h5>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {exceptions.hidden.map((record) => row(record, "hidden"))}
          </ul>
        </div>
      )}
    </section>
  );
}
