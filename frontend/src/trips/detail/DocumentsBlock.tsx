import { Button } from "@/ui/button";
import { Link } from "@tanstack/react-router";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { bytesLabel, type DocumentAsset, type OwnerDocument, type Trip } from "../../tracker-model";
import { DOCUMENT_KIND_LABELS } from "../labels";
import { RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function DocumentsBlock({
  trip,
  documents,
  libraryDocuments,
  openFile,
}: {
  trip: Trip;
  documents: DocumentAsset[];
  libraryDocuments: OwnerDocument[];
  openFile: (url: string, fallback: string) => void;
}) {
  useLocale();
  return (
    <Section id="documents" title={m.owner_private_documents()}>
      <DetailList
        empty={!documents.length && !libraryDocuments.length}
        message={m.owner_no_private_documents_captured()}
      >
        {documents.map((document) => (
          <article key={document.id}>
            <RecordHeading tripId={trip.id} kind="document" id={document.id}>
              {document.title}
            </RecordHeading>
            <p>
              {DOCUMENT_KIND_LABELS[document.document_kind]} ·{" "}
              {document.original_filename ?? m.owner_unnamed_file()} ·{" "}
              {bytesLabel(document.byte_size)}
            </p>
            <Button
              className="secondary compact"
              type="button"
              onClick={() =>
                openFile(document.file_url, m.owner_the_private_document_could_not_be_opened())
              }
            >
              {m.owner_open_document()}
            </Button>
          </article>
        ))}
        {libraryDocuments.map((document) => (
          <article key={`library-${document.id}`}>
            <div className="flex items-baseline justify-between gap-2.5 [&_h3]:m-0">
              <h3>{document.title}</h3>
              <Link className="action-link compact" to="/library">
                {m.owner_go_to_library()}
              </Link>
            </div>
            <p>
              {m.owner_library()} {document.original_filename ?? m.owner_unnamed_file()} ·{" "}
              {bytesLabel(document.byte_size)}
            </p>
            <Button
              className="secondary compact"
              type="button"
              onClick={() =>
                openFile(document.file_url, m.owner_the_library_document_could_not_be_opened())
              }
            >
              {m.owner_open_library_document()}
            </Button>
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
