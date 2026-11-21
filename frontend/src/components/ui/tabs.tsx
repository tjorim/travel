import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

/** Owned registry Tabs: tablist, tab and tabpanel semantics with arrow-key navigation. */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("min-w-0", className)} {...props} />;
}

/** The segmented Travel look shared with ChoiceGroup: a bordered pill of equal choices. */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex max-w-full flex-wrap gap-1 rounded-xl border p-1", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "min-h-11 rounded-lg bg-travel-paper! px-3 text-sm font-medium text-travel-ink! data-active:bg-travel-forest! data-active:text-travel-on-action!",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={className} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
