import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Owned registry Alert; callers retain their existing live-region priority. */
function Alert({
  className,
  role = "status",
  variant = "info",
  ...props
}: ComponentProps<"div"> & { variant?: "info" | "success" | "error" }) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(variant === "error" ? "form-error" : "help", className)}
      {...props}
    />
  );
}

export { Alert };
