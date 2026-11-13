import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { DocumentAsset } from "../api-types";

/**
 * The owner's choice of which trip documents a record (a route or a stay) carries, such as its booking
 * confirmation. Documents stay owner-only: linking one never shares it. Nothing is shown while the trip
 * has no document to link.
 */
export function DocumentLinksField({
  documents,
  value,
  onChange,
}: {
  documents: readonly Pick<DocumentAsset, "id" | "title">[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  useLocale();
  if (documents.length === 0) return null;
  return (
    <FieldSet className="grid gap-2">
      <FieldLegend>
        {m.owner_linked_documents()}{" "}
        <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
      </FieldLegend>
      {documents.map((document) => (
        <Field className="contents" key={document.id}>
          <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
            <TravelCheckbox
              checked={value.includes(document.id)}
              onCheckedChange={() =>
                onChange(
                  value.includes(document.id)
                    ? value.filter((id) => id !== document.id)
                    : [...value, document.id],
                )
              }
            />
            {document.title}
          </FieldLabel>
        </Field>
      ))}
    </FieldSet>
  );
}
