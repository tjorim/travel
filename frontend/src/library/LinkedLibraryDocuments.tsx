import { NavLink } from "react-router-dom";

import { useLinkedLibraryDocuments } from "../query/owner-queries";
import { bytesLabel } from "../tracker-model";

export function LinkedLibraryDocuments({ tripId }: { tripId: string }) {
  // A failed read shows nothing: the documents are managed in the library itself.
  const documents = useLinkedLibraryDocuments(tripId).data ?? [];
  if (!documents.length) return null;

  return <section className="card" aria-labelledby="linked-library-documents-title">
    <div className="capture-heading"><div><h3 id="linked-library-documents-title">Gekoppelde bibliotheekdocumenten</h3><p>Beheer en verwijder deze essentials in de bibliotheek zelf.</p></div><NavLink className="action-link" to="/library">Naar bibliotheek</NavLink></div>
    <div className="saved-moments manager-list">{documents.map((document) => <article className="excerpt-row" key={document.id}><div><strong>{document.title}</strong><span>{document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</span></div></article>)}</div>
  </section>;
}
