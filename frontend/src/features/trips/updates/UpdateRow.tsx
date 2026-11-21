import { Button } from "@/components/ui/button";

import { AuthoredText } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { updateDateLabel } from "@/lib/dates";
import { type TravelUpdate } from "@/api-types";
import type { OwnerSession } from "@/lib/auth";
import { previewBlocker } from "./UpdatePreview";
import { UpdatePhotoStrip, type UpdatePhoto } from "./UpdatePhotos";
import { visibilityLabel } from "../records/visibility";

/** One travel update in the story list: its summary, its photos and a way to see it as a visitor would. */
export function UpdateRow({
  item,
  photos,
  session,
  hasAudience,
  loading,
  onInspect,
  onPreview,
}: {
  item: TravelUpdate;
  photos: UpdatePhoto[];
  session: OwnerSession | null;
  hasAudience: boolean;
  /** The audiences are still being read, so whether a preview exists is not known yet. */
  loading: boolean;
  onInspect: () => void;
  onPreview: () => void;
}) {
  useLocale();
  const blocker = previewBlocker(item, hasAudience);
  const explanationId = `preview-note-${item.id}`;
  return (
    <article className="excerpt-row">
      <Button className="document-select" type="button" onClick={onInspect}>
        <AuthoredText as="strong" record={item} field="title">
          {item.title}
        </AuthoredText>
        <span>
          {updateDateLabel(item)} · {visibilityLabel(item.visibility)} ·{" "}
          {item.area?.label ?? m.updates_no_place()}
        </span>
      </Button>
      <div className="grid justify-items-end gap-1 max-[620px]:justify-items-start">
        <Button
          className="secondary compact"
          type="button"
          disabled={loading || blocker !== null}
          aria-describedby={blocker && !loading ? explanationId : undefined}
          aria-label={m.updates_preview_as_visitor_for({ title: item.title })}
          onClick={onPreview}
        >
          {m.updates_preview_as_visitor()}
        </Button>
        {blocker && !loading && (
          <span id={explanationId} className="max-w-52 text-xs! sm:text-right">
            {blocker()}
          </span>
        )}
      </div>
      {session && <UpdatePhotoStrip update={item} photos={photos} session={session} />}
    </article>
  );
}
