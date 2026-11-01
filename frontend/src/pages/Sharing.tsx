import { EmptyState } from "@/ui/EmptyState";

import { useAuth } from "../auth-context";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { SharingOverview } from "../sharing/SharingOverview";

export function Sharing() {
  useLocale();
  const { session } = useAuth();
  if (!session) return <EmptyState title={m.sharing_overview()}>{m.sign_in_trips()}</EmptyState>;
  return <SharingOverview />;
}
