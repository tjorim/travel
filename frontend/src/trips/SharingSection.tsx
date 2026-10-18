import { PublicationManager } from "./PublicationManager";
import type { SectionProps } from "./workspace-sections";

/** The workspace's sharing tab: what is published and the hidden share links. */
export default function SharingSection({ trip }: SectionProps) {
  return <PublicationManager trip={trip} />;
}
