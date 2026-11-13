import { useState } from "react";

import type { Projection } from "../ProjectionView";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useOwner, useTripResource } from "../query/owner-queries";
import type {
  ShareLink,
  ShareScope,
  TravelUpdate,
  Trip,
  PublicProjectionStatus,
} from "../api-types";
import { PreviewDialog, type Preview } from "./publication/PreviewDialog";
import { usePublicationMutations } from "./publication/use-publication-mutations";

type Audience = { kind: "public" } | { kind: "link"; link: ShareLink };

const lists = (scope: ShareScope, update: TravelUpdate) =>
  scope.items.some((item) => item.kind === "travel_update" && item.id === update.id);
const receives = (update: TravelUpdate, scope: ShareScope) =>
  update.visibility === "everyone" || (update.visibility === "custom" && lists(scope, update));

/**
 * The audience whose preview shows this update: the published public page, else a live hidden link, else a
 * page not yet published or a draft link that would deliver it. Null when nobody would receive it.
 */
export function previewAudience(
  update: TravelUpdate,
  status: PublicProjectionStatus | null | undefined,
  links: ShareLink[],
): Audience | null {
  if (update.visibility === "private") return null;
  const live = (state: ShareLink["state"]) =>
    links.find((link) => link.state === state && receives(update, link.scope));
  const publicDelivers = Boolean(status && receives(update, status.scope));
  if (status?.surface_state === "published" && publicDelivers) return { kind: "public" };
  const active = live("active");
  if (active) return { kind: "link", link: active };
  if (publicDelivers) return { kind: "public" };
  const draft = live("draft");
  return draft ? { kind: "link", link: draft } : null;
}

/** Why an update has no preview, as a short sentence; null when one can be shown. */
export function previewBlocker(update: TravelUpdate, hasAudience: boolean): (() => string) | null {
  if (update.visibility === "private") return () => m.owner_preview_private_update();
  if (!update.body.trim()) return () => m.owner_preview_needs_text();
  if (update.area && !update.area.label) return () => m.owner_preview_needs_area_name();
  if (!hasAudience) return () => m.owner_preview_no_audience();
  return null;
}

/** The projection item that is this update: the delivered copy carries the same title and text for visitors. */
const itemOf = (document: Projection, update: TravelUpdate) =>
  document.updates.find((item) => item.title === update.title && item.body === update.body)?.id;

/**
 * Opens the existing rendered preview for an audience that receives one update, scrolled to that update.
 * The preview is the one the Sharing tab shows; nothing is saved and no link is created.
 */
export function useUpdatePreview(trip: Trip, onError: (error: unknown) => void) {
  useLocale();
  const owner = useOwner();
  const status = useTripResource(trip.id, "public-projection");
  const linksQuery = useTripResource(trip.id, "share-links");
  const links = linksQuery.data ?? [];
  const { previewPublicScope, previewLinkScope } = usePublicationMutations(trip.id);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const loading = status.isPending || linksQuery.isPending;

  const audienceOf = (update: TravelUpdate) => previewAudience(update, status.data, links);

  async function open(update: TravelUpdate) {
    const audience = audienceOf(update);
    if (!audience || pending) return;
    setPending(true);
    try {
      if (audience.kind === "public" && status.data) {
        const scope = status.data.scope;
        const document = (await previewPublicScope.mutateAsync(scope)) as Projection;
        setPreview({
          name: m.assets_public_preview,
          audience: "public",
          scope,
          document,
          focusId: itemOf(document, update),
        });
      } else if (audience.kind === "link") {
        const { link } = audience;
        const document = (await previewLinkScope.mutateAsync({
          link,
          scope: link.scope,
        })) as Projection;
        setPreview({
          name: () => m.assets_preview_of({ p0: link.label }),
          audience: "share",
          linkId: link.id,
          scope: link.scope,
          document,
          focusId: itemOf(document, update),
        });
      }
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  return {
    loading,
    pending,
    audienceOf,
    open,
    dialog:
      preview && owner ? (
        <PreviewDialog
          preview={preview}
          links={links}
          isPublished={status.data?.surface_state === "published"}
          tripId={trip.id}
          session={owner.session}
          onClose={() => setPreview(null)}
        />
      ) : null,
  };
}
