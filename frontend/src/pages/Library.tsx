import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { useAuth } from "../auth-context";
import { EmptyState } from "@/ui/EmptyState";
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
        <p className="travel-eyebrow">{m.assets_separate_from_your_trips()}</p>
        <h2 id="library-title">{m.library()}</h2>
        <p>{m.assets_travel_documents_and_emergency_information_that_belong_to_no_specific_tr()}</p>
      </div>
      <DocumentLibraryManager />
      <EmergencyInfoManager />
      <OfflineManager />
    </section>
  );
}
