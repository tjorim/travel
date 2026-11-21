import { EmptyState } from "@/components/ui/EmptyState";

import { useAuth } from "../auth-context";
import { useLocale } from "@/i18n/locale";
import { m } from "../paraglide/messages.js";
import { SharingOverview } from "../sharing/SharingOverview";

export function Sharing() {
  useLocale();
  const { session } = useAuth();
  if (!session) return <EmptyState title={m.sharing_overview()}>{m.sign_in_trips()}</EmptyState>;
  return <SharingOverview />;
}
