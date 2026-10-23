import { Button } from "@/ui/button";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";

/** The edit and delete buttons under a record's read-only dialog view; `children` sit between them (for example a merge button). */
export function RecordActions({
  onEdit,
  onDelete,
  children,
}: {
  onEdit: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  useLocale();
  return (
    <div className="button-row">
      <Button type="button" onClick={onEdit}>
        {m.owner_edit()}
      </Button>
      {children}
      <Button className="danger" type="button" onClick={onDelete}>
        {m.owner_delete()}
      </Button>
    </div>
  );
}
