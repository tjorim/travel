import { lazy, Suspense, useState } from "react";
import { Button } from "@/ui/button";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";

const CompactPreferences = lazy(() => import("./CompactPreferences"));

/** Load the shared preferences disclosure only when requested. */
export function Preferences() {
  useLocale();
  const [opened, setOpened] = useState(false);
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
