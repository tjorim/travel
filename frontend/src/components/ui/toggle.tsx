import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cn } from "@/lib/utils";

/** Owned registry Toggle in the Travel secondary-button look; pressed fills with the action colour. */
function Toggle({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(
        "secondary compact data-pressed:border-travel-forest! data-pressed:bg-travel-forest! data-pressed:text-travel-on-action! data-pressed:inset-shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Toggle };
