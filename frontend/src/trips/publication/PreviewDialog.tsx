import { Collapsible } from "@/ui/collapsible";

import type { TrackerSession } from "../../auth";
import type { Projection } from "../../ProjectionView";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { RecordDialog } from "../../RecordDialog";
import type { ShareLink, ShareScope } from "../../tracker-model";
import { RenderedPreview } from "../RenderedPreview";
import { LINK_STATE_LABELS, projectionSummary } from "./catalog";

export type Preview = {
  name: string | (() => string);
  audience: "public" | "share";
  linkId?: string;
  /** The candidate scope that was rendered; files and directions are resolved against the same scope. */
  scope: ShareScope;
  document: Projection;
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
  session: TrackerSession;
  onClose: () => void;
}) {
  useLocale();
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
            ? m.assets_audience_everyone()
            : m.assets_audience_only_people_with_the_active_hidden_link()}{" "}
          ·{" "}
          {preview.audience === "public"
            ? isPublished
              ? m.assets_currently_shared()
              : m.assets_not_shared_yet()
            : LINK_STATE_LABELS[links.find((link) => link.id === preview.linkId)?.state ?? "draft"]}
        </p>
        <p>{projectionSummary(preview.document)}</p>
        <p className="help">{m.sharing_preview_unsaved_note()}</p>
        <RenderedPreview
          projection={preview.document}
          audience={preview.audience}
          tripId={tripId}
          linkId={preview.linkId}
          scope={preview.scope}
          session={session}
        />
        <Collapsible.Root>
          <Collapsible.Trigger className="bg-transparent p-0 text-left font-bold text-travel-forest">
            {m.assets_inspect_delivered_fields()}
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted>
            <pre>{JSON.stringify(preview.document, null, 2)}</pre>
          </Collapsible.Panel>
        </Collapsible.Root>
      </section>
    </RecordDialog>
  );
}
