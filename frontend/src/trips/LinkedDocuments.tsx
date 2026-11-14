import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource } from "../query/owner-queries";

/** The titles of the documents a record links, for the owner's detail view. Renders nothing without a link. */
export function LinkedDocuments({ tripId, ids }: { tripId: string; ids: readonly string[] }) {
  useLocale();
  const documents = useTripResource(tripId, "documents").data ?? [];
  const linked = documents.filter((document) => ids.includes(document.id));
  if (linked.length === 0) return null;
  return (
    <div>
      <strong>{m.documents_linked_documents()}</strong>
      <ul>
        {linked.map((document) => (
          <li key={document.id}>{document.title}</li>
        ))}
      </ul>
    </div>
  );
}
