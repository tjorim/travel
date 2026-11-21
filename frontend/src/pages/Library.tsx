import { m } from "../paraglide/messages.js";
import { useLocale } from "@/i18n/locale";
import { useAuth } from "@/app/providers/auth-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentManager } from "../documents/DocumentManager";
import { EmergencyInfoManager } from "../library/EmergencyInfoManager";
import { OfflineManager } from "../offline/OfflineManager";
import { HomeLink } from "@/components/HomeLink";

export function Library() {
  useLocale();
  const { session } = useAuth();
  if (!session) return <EmptyState title={m.library()}>{m.sign_in_library()}</EmptyState>;

  return (
    <section className="grid gap-4.5" aria-labelledby="library-title">
      <div>
        <p className="travel-eyebrow">{m.library_separate_from_your_trips()}</p>
        <h2 id="library-title">{m.library()}</h2>
        <p>{m.library_intro()}</p>
        <p>
          {m.library_trip_documents_note()} <HomeLink to="/trips">{m.trips()}</HomeLink>
        </p>
      </div>
      <DocumentManager />
      <EmergencyInfoManager />
      <OfflineManager />
    </section>
  );
}
