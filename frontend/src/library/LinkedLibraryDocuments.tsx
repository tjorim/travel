import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Link } from "@tanstack/react-router";

import { useLinkedLibraryDocuments } from "../query/owner-queries";
import { bytesLabel } from "../files";

export function LinkedLibraryDocuments({ tripId }: { tripId: string }) {
  useLocale();
  // A failed read shows nothing: the documents are managed in the library itself.
  const documents = useLinkedLibraryDocuments(tripId).data ?? [];
  if (!documents.length) return null;

  return (
    <section className="travel-card" aria-labelledby="linked-library-documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="linked-library-documents-title">{m.library_linked_library_documents()}</h3>
          <p>{m.library_manage_and_delete_these_essentials_in_the_library()}</p>
        </div>
        <Link className="action-link" to="/library">
          {m.owner_go_to_library()}
        </Link>
      </div>
      <div className="saved-records mt-0.5">
        {documents.map((document) => (
          <article className="excerpt-row" key={document.id}>
            <div>
              <strong>{document.title}</strong>
              <span>
                {document.original_filename ?? m.owner_unnamed_file()} ·{" "}
                {bytesLabel(document.byte_size)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
