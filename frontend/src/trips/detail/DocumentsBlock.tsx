import { Button } from "@/ui/button";

import { useLocale } from "@/i18n/locale";
import { m } from "../../paraglide/messages.js";
import { bytesLabel } from "@/lib/files";
import { type DocumentAsset, type Trip } from "../../api-types";
import { DOCUMENT_KIND_LABELS } from "@/lib/labels";
import { RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function DocumentsBlock({
  trip,
  documents,
  openFile,
}: {
  trip: Trip;
  documents: DocumentAsset[];
  openFile: (url: string, fallback: string) => void;
}) {
  useLocale();
  return (
    <Section id="documents" title={m.common_private_documents()}>
      <DetailList empty={!documents.length} message={m.documents_no_private_documents_captured()}>
        {documents.map((document) => (
          <article key={document.id}>
            <RecordHeading tripId={trip.id} kind="document" id={document.id}>
              {document.title}
            </RecordHeading>
            <p>
              {DOCUMENT_KIND_LABELS[document.document_kind]} ·{" "}
              {document.original_filename ?? m.common_unnamed_file()} ·{" "}
              {bytesLabel(document.byte_size)}
            </p>
            <Button
              className="secondary compact"
              type="button"
              onClick={() =>
                openFile(document.file_url, m.documents_the_private_document_could_not_be_opened())
              }
            >
              {m.documents_open_document()}
            </Button>
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
