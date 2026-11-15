import { Alert } from "@/ui/alert";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Collapsible } from "@/ui/collapsible";
import { useState } from "react";

import type { OwnerSession } from "../../auth";
import type { Projection } from "../../ProjectionView";
import { useContentLanguage, type ContentLanguage } from "../../content-language";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import { RecordDialog } from "../../RecordDialog";
import type { ShareLink, ShareScope } from "../../api-types";
import { RenderedPreview } from "../RenderedPreview";
import { kindCountsText, LINK_STATE_LABELS, projectionSummary } from "./catalog";
import { FutureDisclosureReview } from "./SharingReview";
import { useExclusionReview } from "./use-exclusion-review";
import { useFutureDisclosure } from "./use-future-disclosure";

export type Preview = {
  name: string | (() => string);
  audience: "public" | "share";
  linkId?: string;
  /** The candidate scope that was rendered; files and directions are resolved against the same scope. */
  scope: ShareScope;
  document: Projection;
  /** The delivered item to bring into view, such as one travel update; none leaves the preview at its top. */
  focusId?: string;
};

/** What a visitor would receive for the public page or one share link, rendered and as the delivered fields. */
export function PreviewDialog({
  preview,
  links,
  isPublished,
  tripId,
  session,
  onClose,
}: {
  preview: Preview;
  links: ShareLink[];
  isPublished: boolean;
  tripId: string;
  session: OwnerSession;
  onClose: () => void;
}) {
  useLocale();
  // The document arrives in the trip's own language; the owner can read it as a visitor of the other one would.
  const own = useContentLanguage();
  const [language, setLanguage] = useState<ContentLanguage>(own);
  const [document, setDocument] = useState<Projection>(preview.document);
  const [languageError, setLanguageError] = useState<unknown>(null);
  const previewBase =
    preview.audience === "public"
      ? tripPath(tripId, "public-projection")
      : tripPath(tripId, `share-links/${encodeURIComponent(preview.linkId ?? "")}`);
  const reload = useOwnerMutation<ContentLanguage, Projection>({
    fallback: m.publication_the_public_preview_could_not_be_loaded,
    request: (next) => ({
      path: `${previewBase}/preview?lang=${next}`,
      method: "POST",
      body: preview.scope,
    }),
    // A preview is shown once and not kept.
    invalidate: () => [],
  });
  function chooseLanguage(next: ContentLanguage) {
    if (next === language) return;
    setLanguageError(null);
    reload.mutateAsync(next).then((result) => {
      setLanguage(next);
      setDocument(result);
    }, setLanguageError);
  }
  // The preview is the audience's real delivery; this says how it differs from the public page.
  const review = useExclusionReview(tripId, preview.scope);
  const left = preview.audience === "share" ? (review.data?.excluded.length ?? 0) : 0;
  // What this candidate shows of a trip that has not started: the same counts the Sharing check words, for this audience.
  const future = useFutureDisclosure(
    tripId,
    preview.audience === "public" ? { kind: "public" } : { kind: "link", linkId: preview.linkId },
    preview.scope,
  );
  const futureName =
    preview.audience === "public"
      ? m.publication_the_page_for_everyone()
      : m.publication_link({ name: links.find((link) => link.id === preview.linkId)?.label ?? "" });
  return (
    <RecordDialog
      open
      title={typeof preview.name === "function" ? preview.name() : preview.name}
      className="max-w-280"
      onDismiss={onClose}
    >
      <section
        className="publication-panel [&_h3]:m-0 [&_p]:m-0 [&_pre]:max-h-80 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-travel-ink [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-travel-tint"
        aria-live="polite"
      >
        <p>
          {preview.audience === "public"
            ? m.publication_audience_everyone()
            : m.publication_audience_only_people_with_the_active_hidden_link()}{" "}
          ·{" "}
          {preview.audience === "public"
            ? isPublished
              ? m.publication_currently_shared()
              : m.publication_not_shared_yet()
            : LINK_STATE_LABELS[links.find((link) => link.id === preview.linkId)?.state ?? "draft"]}
        </p>
        <p>{projectionSummary(document)}</p>
        <ChoiceGroup
          label={m.publication_preview_language_label()}
          value={language}
          choices={[
            { value: "nl", label: m.localized_dutch() },
            { value: "en", label: m.localized_english() },
          ]}
          onChange={chooseLanguage}
        />
        <p className="help">{m.publication_preview_language_hint()}</p>
        {languageError !== null && (
          <Alert variant="error" role="alert">
            {errorMessage(languageError, m.publication_the_public_preview_could_not_be_loaded)}
          </Alert>
        )}
        {left > 0 && (
          <p>
            {m.exclusions_preview_note({ count: left })}
            {!!Object.keys(review.data?.also_hidden ?? {}).length &&
              ` ${m.exclusions_preview_also({ counts: kindCountsText(review.data?.also_hidden) })}`}
          </p>
        )}
        <FutureDisclosureReview review={future} name={futureName} />
        <p className="help">{m.sharing_preview_unsaved_note()}</p>
        <RenderedPreview
          projection={document}
          language={language}
          audience={preview.audience}
          tripId={tripId}
          linkId={preview.linkId}
          scope={preview.scope}
          session={session}
          focusId={preview.focusId}
        />
        <Collapsible.Root>
          <Collapsible.Trigger className="bg-transparent p-0 text-left font-bold text-travel-forest">
            {m.publication_inspect_delivered_fields()}
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted>
            <pre>{JSON.stringify(document, null, 2)}</pre>
          </Collapsible.Panel>
        </Collapsible.Root>
      </section>
    </RecordDialog>
  );
}
