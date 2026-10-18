import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One block of a workspace tab, collapsible under a title bar that can show a count. The block stays mounted when
 * collapsed so an editor's draft or open dialog is not lost, and the wrapper owns the element id that `#id` links and
 * the jump search point at.
 */
export function SectionAccordion({
  id,
  title,
  count,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root
      className="grid scroll-mt-4 gap-2"
      id={id}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-2 rounded-xl border border-travel-card-border bg-travel-surface px-3.5 text-left font-bold text-travel-ink">
        <ChevronDownIcon
          className="size-4 shrink-0 text-travel-muted transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span>{title}</span>
        {count !== undefined && (
          <span className="ml-auto text-sm font-medium text-travel-muted">{count}</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-2">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
