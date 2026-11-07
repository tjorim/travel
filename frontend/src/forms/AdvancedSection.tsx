import { Collapsible } from "@/ui/collapsible";
import { useEffect, useState, type ReactNode } from "react";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";

/**
 * A collapsed "Advanced" disclosure for controls most owners never touch. It starts open when `inUse` says
 * something inside already differs from the default, and opens by itself if that becomes true later (a different
 * audience is loaded), so a stored choice is never hidden. It never closes by itself.
 */
export function AdvancedSection({
  summary,
  inUse,
  children,
}: {
  /** One line under the title saying what is inside, shown before opening. */
  summary: string;
  inUse: boolean;
  children: ReactNode;
}) {
  useLocale();
  const [open, setOpen] = useState(inUse);
  useEffect(() => {
    if (inUse) setOpen(true);
  }, [inUse]);
  return (
    <Collapsible.Root className="scope-group" data-disclosure="" open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="max-sm:flex-wrap max-sm:justify-start max-sm:[&>strong]:basis-3/4 max-sm:[&>span]:basis-full max-sm:[&>span]:pl-6">
        <strong>{m.sharing_advanced_title()}</strong>
        <span>{summary}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-3 px-3.25 pt-0 pb-3.25">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
