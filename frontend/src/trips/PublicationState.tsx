import { Badge } from "@/ui/badge";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource } from "../query/owner-queries";

/** Whether the public page is live. Unlisted links are not summarised here: the Sharing section lists them. */
export default function PublicationState({ tripId }: { tripId: string }) {
  useLocale();
  const status = useTripResource(tripId, "public-projection").data;
  if (!status) return null;
  const live = status.surface_state === "published";
  return (
    <Badge variant={live ? "live" : "offline"}>
      {live ? m.owner_public_page_live() : m.owner_not_published()}
    </Badge>
  );
}
