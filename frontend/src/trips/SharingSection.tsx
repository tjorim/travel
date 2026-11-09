import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { LiveLocation } from "./LiveLocation";
import { HomeLink } from "./HomeLink";
import { PublicationManager } from "./PublicationManager";
import type { SectionProps } from "./workspace-sections";

/** The workspace's sharing tab: what is published and the hidden share links. */
export default function SharingSection({ trip }: SectionProps) {
  useLocale();
  return (
    <>
      <HomeLink to="/sharing">{m.sharing_overview()}</HomeLink>
      <PublicationManager trip={trip} />
      <LiveLocation tripId={trip.id} />
    </>
  );
}
