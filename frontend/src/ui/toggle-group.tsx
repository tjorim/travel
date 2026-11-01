import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "@/lib/utils";
import { Toggle } from "@/ui/toggle";

/** Owned registry Toggle Group: a labelled group of independent pressed buttons. */
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

const ToggleGroupItem = Toggle;

export { ToggleGroup, ToggleGroupItem };
