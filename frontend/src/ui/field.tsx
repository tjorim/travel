import { Field as BaseField } from "@base-ui/react/field";
import { Fieldset } from "@base-ui/react/fieldset";
import { cn } from "cn";
import type { ComponentProps } from "react";

/** shadcn's Field family, backed by Base UI so labels, errors and validity are wired to the control. */
export function Field({ className, ...props }: BaseField.Root.Props) {
  return <BaseField.Root data-slot="field" className={cn("grid content-start gap-1.5", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: BaseField.Label.Props) {
  return <BaseField.Label data-slot="field-label" className={className} {...props} />;
}

export function FieldDescription({ className, ...props }: BaseField.Description.Props) {
  return <BaseField.Description data-slot="field-description" className={cn("m-0 text-sm", className)} {...props} />;
}

/** Shown only while it has a message, and announced when it appears. */
export function FieldError({ className, children, ...props }: BaseField.Error.Props) {
  if (!children) return null;
  return (
    <BaseField.Error data-slot="field-error" match role="alert" className={cn("field-error", className)} {...props}>
      {children}
    </BaseField.Error>
  );
}

export function FieldSet({ className, ...props }: ComponentProps<typeof Fieldset.Root>) {
  return <Fieldset.Root data-slot="field-set" className={className} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<typeof Fieldset.Legend>) {
  return <Fieldset.Legend data-slot="field-legend" render={<legend />} className={className} {...props} />;
}
