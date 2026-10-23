import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation, RecordDialog } from "../../RecordDialog";
import { Field, FieldLabel } from "@/ui/field";
import {
  bagTypes,
  type BagDraft,
  type PackingRequest,
  type PackingSave,
  type PendingDelete,
} from "./model";

/** Adds or edits one bag; `dialog` is the bag's id, "new", or null while closed. */
export function BagDialog({
  dialog,
  draft,
  setDraft,
  busy,
  path,
  save,
  request,
  confirm,
  onConfirmDelete,
  onClose,
}: {
  dialog: string | null;
  draft: BagDraft;
  setDraft: (draft: BagDraft) => void;
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
      title={dialog === "new" ? m.assets_add_bag() : m.assets_edit_bag()}
      onDismiss={() => onClose()}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.name.trim()) return;
          void save(
            () =>
              request(
                `${path}/bags${dialog === "new" ? "" : `/${encodeURIComponent(dialog!)}`}`,
                dialog === "new" ? "POST" : "PATCH",
                { ...draft, name: draft.name.trim() },
              ),
            () => m.assets_bag_saved(),
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
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel className="block">{m.assets_type()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.assets_type()}
            value={draft.type ?? ""}
            onChange={(value) => setDraft({ ...draft, type: value || null })}
          >
            <option value="">{m.assets_no_type()}</option>
            {bagTypes().map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_weight_limit_grams()}
            <Input
              type="number"
              min="1"
              value={draft.weight_limit_g ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  weight_limit_g: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </FieldLabel>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {m.assets_save()}
          </Button>
          {dialog !== "new" && (
            <Button
              type="button"
              className="danger compact"
              onClick={() => onConfirmDelete({ kind: "bag", id: dialog! })}
            >
              {m.owner_delete()}
            </Button>
          )}
        </div>
      </form>
      {confirm?.kind === "bag" && (
        <DeleteConfirmation
          title={m.assets_delete_bag()}
          description={m.assets_the_items_remain_as_unassigned()}
          onCancel={() => onConfirmDelete(null)}
          onConfirm={() => {
            void save(
              () => request(`${path}/bags/${encodeURIComponent(confirm.id)}`, "DELETE"),
              () => m.assets_bag_deleted_items_are_unassigned(),
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
