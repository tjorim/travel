import { Checkbox } from "@base-ui/react/checkbox";
import { cn } from "cn";

/** The shared visual treatment for Base UI checkboxes in owner forms and lists. */
export function TravelCheckbox({ className, ...props }: Checkbox.Root.Props) {
  return (
    <Checkbox.Root
      {...props}
      aria-labelledby={props["aria-label"] ? "" : props["aria-labelledby"]}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded border border-travel-input-border bg-travel-surface text-travel-on-action data-checked:border-travel-forest data-checked:bg-travel-forest data-disabled:opacity-50 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-travel-focus",
        className,
      )}
    >
      <Checkbox.Indicator className="text-xs font-extrabold leading-none" aria-hidden="true">
        ✓
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
