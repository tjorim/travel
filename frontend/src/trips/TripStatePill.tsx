import { cn } from "cn";

import { useLocale } from "../locale";
import { tripStateLabel, type TripState } from "./trip-state";

const DOT: Record<TripState, string> = {
  active: "bg-travel-link",
  upcoming: "bg-travel-warning",
  planned: "bg-travel-optional",
  past: "bg-travel-border",
};

/** The state of a trip as a quiet label with a coloured dot; the text always carries the meaning. */
export function TripStatePill({ state, className }: { state: TripState; className?: string }) {
  useLocale();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-extrabold tracking-travel-eyebrow text-travel-eyebrow uppercase",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[state])} />
      {tripStateLabel(state)}
    </span>
  );
}
