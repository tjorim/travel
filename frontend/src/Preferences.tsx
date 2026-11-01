import { lazy, Suspense, useState } from "react";
import { Button } from "@/ui/button";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { AppearanceControl } from "./appearance";
import { LocaleControl } from "./locale";

const CompactPreferences = lazy(() => import("./CompactPreferences"));

/** Language and appearance in one wrapping row, placed at the top of a page shell so it lines up with the page. */
export function Preferences({ compact = false }: { compact?: boolean }) {
  useLocale();
  const [opened, setOpened] = useState(false);
  if (compact) {
    const trigger = (
      <Button className="secondary compact" onClick={() => setOpened(true)}>
        {m.visitor_preferences()}
      </Button>
    );
    return opened ? (
      <Suspense fallback={trigger}>
        <CompactPreferences />
      </Suspense>
    ) : (
      trigger
    );
  }
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <LocaleControl />
      <AppearanceControl />
    </div>
  );
}
