import { cn } from "cn";

/** A card-surfaced message for a view with nothing to show; owned adaptation of the registry `empty`. */
function Empty({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="empty"
      className={cn(
        "travel-card flex w-full min-w-0 max-w-travel-reading flex-col items-start gap-2",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="empty-title" className={cn("m-0", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("m-0 [&>a]:underline [&>a]:underline-offset-4", className)}
      {...props}
    />
  );
}

export { Empty, EmptyDescription, EmptyTitle };
