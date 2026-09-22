import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, bytesLabel, type OwnerDocument } from "../tracker-model";

export function LinkedLibraryDocuments({ tripId }: { tripId: string }) {
  const { session } = useAuth();
  const [documents, setDocuments] = useState<OwnerDocument[]>([]);

  useEffect(() => {
    if (!session) return;
    void fetch(`/api/library/documents?linked_trip_id=${tripId}`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<OwnerDocument[]> : apiError(response, "Gekoppelde bibliotheekdocumenten konden niet worden geladen."))
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [session, tripId]);

  if (!documents.length) return null;

  return <section className="card" aria-labelledby="linked-library-documents-title">
    <div className="capture-heading"><div><h3 id="linked-library-documents-title">Gekoppelde bibliotheekdocumenten</h3><p>Beheer en verwijder deze essentials in de bibliotheek zelf.</p></div><NavLink className="action-link" to="/library">Naar bibliotheek</NavLink></div>
    <div className="saved-moments manager-list">{documents.map((document) => <article className="excerpt-row" key={document.id}><div><strong>{document.title}</strong><span>{document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</span></div></article>)}</div>
  </section>;
}
