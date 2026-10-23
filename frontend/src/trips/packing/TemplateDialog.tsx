import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { RecordDialog } from "../../RecordDialog";
import { Field, FieldLabel } from "@/ui/field";
import type { PackingRequest, PackingSave } from "./model";

/** Saves the current list as a reusable template; `name` is the proposed name, or null while closed. */
export function TemplateDialog({
  name,
  onName,
  busy,
  path,
  save,
  request,
  onClose,
}: {
  name: string | null;
  onName: (name: string) => void;
  busy: boolean;
  path: string;
  save: PackingSave;
  request: PackingRequest;
  onClose: () => void;
}) {
  useLocale();
  return (
    <RecordDialog
      open={name !== null}
      title={m.assets_save_as_template()}
      onDismiss={() => onClose()}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name?.trim()) return;
          void save(
            () => request(`${path}/templates`, "POST", { name: name.trim() }),
            () => m.assets_template_saved(),
          ).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_template_name()}
            <Input
              autoFocus
              required
              maxLength={160}
              value={name ?? ""}
              onChange={(event) => onName(event.target.value)}
            />
          </FieldLabel>
        </Field>
        <Button type="submit" disabled={busy || !name?.trim()}>
          {m.assets_save_2()}
        </Button>
      </form>
    </RecordDialog>
  );
}
