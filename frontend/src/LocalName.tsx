import { cn } from "cn";
import type { HTMLAttributes } from "react";

/**
 * A place's name as written where the place is. It is not in the interface language, nor in the trip's, and the
 * app cannot tell which language it is, so it says so with `lang=""` (unknown); leaving `lang` off would inherit the
 * document's language and read the name in it. `dir="auto"` lets a
 * right-to-left name read the right way round inside a left-to-right line.
 */
export function LocalName({
  name,
  className,
  ...rest
}: { name: string } & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "lang" | "dir">) {
  return (
    <span lang="" dir="auto" className={cn("text-travel-muted", className)} {...rest}>
      {name}
    </span>
  );
}
