import { Checkbox } from "./checkbox";
import type { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

/** Preserve the application API and explicit-label handling around the generated control. */
export function TravelCheckbox(props: CheckboxPrimitive.Root.Props) {
  return <Checkbox {...props} aria-labelledby={props["aria-label"] ? "" : props["aria-labelledby"]} />;
}
