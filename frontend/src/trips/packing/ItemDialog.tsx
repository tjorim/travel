import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation, RecordDialog } from "../../RecordDialog";
import { Field, FieldLabel } from "../../ui/field";
import { TravelCheckbox } from "../../ui/TravelCheckbox";
import { TravelTextarea } from "../../ui/TravelTextarea";
import type { Bag, ItemDraft, PackingRequest, PackingSave, PendingDelete } from "./model";

/** Adds or edits one item; `dialog` is the item's id, "new", or null while closed. */
export function ItemDialog({
  dialog,
  draft,
  setDraft,
  bags,
  busy,
  path,
  save,
  request,
  confirm,
  onConfirmDelete,
  onClose,
}: {
  dialog: string | null;
  draft: ItemDraft;
  setDraft: (draft: ItemDraft) => void;
  bags: Bag[];
  busy: boolean;
  path: string;
  save: PackingSave;
  request: PackingRequest;
  confirm: PendingDelete;
  onConfirmDelete: (confirm: PendingDelete) => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <RecordDialog
      open={dialog !== null}
      title={dialog === "new" ? m.assets_add_item() : m.assets_edit_item()}
      onDismiss={() => onClose()}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.label.trim() || (draft.cabin_only && draft.checked_only)) return;
          void save(
            () =>
              request(
                `${path}/items${dialog === "new" ? "" : `/${encodeURIComponent(dialog!)}`}`,
                dialog === "new" ? "POST" : "PATCH",
                { ...draft, label: draft.label.trim() },
              ),
            () => m.assets_item_saved(),
          ).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <Field className="contents">
          <FieldLabel className="block">
            {m.owner_name()}
            <Input
              autoFocus
              required
              maxLength={160}
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_quantity()}
            <Input
              type="number"
              min="1"
              max="99"
              required
              value={draft.quantity}
              onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })}
            />
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_category()}
            <Input
              maxLength={80}
              value={draft.category ?? ""}
              onChange={(event) => setDraft({ ...draft, category: event.target.value || null })}
            />
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel className="block">{m.assets_bag()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.assets_bag()}
            value={draft.bag_id ?? ""}
            onChange={(value) => setDraft({ ...draft, bag_id: value || null })}
          >
            <option value="">{m.assets_unassigned()}</option>
            {bags.map((bag) => (
              <option key={bag.id} value={bag.id}>
                {bag.name}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_weight_per_item_grams()}
            <Input
              type="number"
              min="0"
              value={draft.weight_g ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  weight_g: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_note()}
            <TravelTextarea
              maxLength={4000}
              value={draft.notes ?? ""}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })}
            />
          </FieldLabel>
        </Field>
        {(["essential", "last_minute", "valuable", "cabin_only", "checked_only"] as const).map(
          (flag) => (
            <Field className="contents" key={flag}>
              <FieldLabel className="flex min-h-11 items-center gap-2">
                <TravelCheckbox
                  className="size-5"
                  checked={draft[flag]}
                  onCheckedChange={(checked) => setDraft({ ...draft, [flag]: checked })}
                />{" "}
                {
                  {
                    essential: m.assets_essential(),
                    last_minute: m.assets_departure_day_lastminute(),
                    valuable: m.assets_valuable(),
                    cabin_only: m.assets_cabin_baggage_only(),
                    checked_only: m.assets_checked_baggage_only(),
                  }[flag]
                }
              </FieldLabel>
            </Field>
          ),
        )}
        {draft.cabin_only && draft.checked_only && (
          <p role="alert">{m.assets_choose_at_most_one_baggage_restriction()}</p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || (draft.cabin_only && draft.checked_only)}>
            {m.assets_save()}
          </Button>
          {dialog !== "new" && (
            <Button
              type="button"
              className="danger compact"
              onClick={() => onConfirmDelete({ kind: "item", id: dialog! })}
            >
              {m.owner_delete()}
            </Button>
          )}
        </div>
      </form>
      {confirm?.kind === "item" && (
        <DeleteConfirmation
          title={m.assets_delete_item()}
          onCancel={() => onConfirmDelete(null)}
          onConfirm={() => {
            void save(
              () => request(`${path}/items/${encodeURIComponent(confirm.id)}`, "DELETE"),
              () => m.assets_item_deleted(),
            ).then((ok) => {
              if (ok) {
                onClose();
                onConfirmDelete(null);
              }
            });
          }}
        />
      )}
    </RecordDialog>
  );
}
