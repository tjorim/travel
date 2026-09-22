import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentLibraryManager } from "../library/DocumentLibraryManager";
import { EmergencyInfoManager } from "../library/EmergencyInfoManager";
import { OfflineManager } from "../offline/OfflineManager";

export function Library() {
  const { session } = useAuth();
  if (!session) return <EmptyState title="Bibliotheek">Meld aan om gedeelde essentials en noodinformatie te bekijken.</EmptyState>;

  return <section className="library" aria-labelledby="library-title">
    <div><p className="eyebrow">Los van je reizen</p><h2 id="library-title">Bibliotheek</h2><p>Reisdocumenten en noodinformatie die niet aan één specifieke reis vastzitten. Koppel een document optioneel aan een reis vanuit de bibliotheek zelf.</p></div>
    <DocumentLibraryManager />
    <EmergencyInfoManager />
    <OfflineManager />
  </section>;
}
