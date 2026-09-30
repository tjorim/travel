import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentLibraryManager } from "../library/DocumentLibraryManager";
import { EmergencyInfoManager } from "../library/EmergencyInfoManager";
import { OfflineManager } from "../offline/OfflineManager";

export function Library() {
  useLocale();
  const { session } = useAuth();
  if (!session) return <EmptyState title={m.library()}>{m.sign_in_library()}</EmptyState>;

  return (
    <section className="grid gap-4.5" aria-labelledby="library-title">
      <div>
        <p className="travel-eyebrow">Los van je reizen</p>
        <h2 id="library-title">{m.library()}</h2>
        <p>
          Reisdocumenten en noodinformatie die niet aan één specifieke reis vastzitten. Koppel een document optioneel
          aan een reis vanuit de bibliotheek zelf.
        </p>
      </div>
      <DocumentLibraryManager />
      <EmergencyInfoManager />
      <OfflineManager />
    </section>
  );
}
