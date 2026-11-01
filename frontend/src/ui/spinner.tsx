import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Decorative busy glyph. The text beside it, inside a `role="status"` region or a pending
 * button, carries the announcement, so the icon is hidden from assistive technology. It
 * turns only when motion is allowed; with `prefers-reduced-motion: reduce` it stays still.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden="true"
      className={cn("size-4 shrink-0 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
