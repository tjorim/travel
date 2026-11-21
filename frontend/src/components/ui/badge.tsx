import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@/lib/utils";

/** Owned registry Badge; text carries the meaning, with no live-region side effects. */
function Badge({
  className,
  variant = "outline",
  render,
  ...props
}: useRender.ComponentProps<"span"> & { variant?: "outline" | "live" | "offline" }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full",
          variant === "outline"
            ? "border border-travel-card-border bg-travel-surface px-3 py-1.5 text-sm text-travel-muted"
            : "px-2.5 py-1 text-xs font-extrabold",
          variant === "live" && "bg-travel-online-surface text-travel-online-ink",
          variant === "offline" && "bg-travel-disconnected-surface text-travel-disconnected-ink",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "badge", variant },
  });
}

export { Badge };
