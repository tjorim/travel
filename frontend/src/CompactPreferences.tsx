import { Popover, PopoverTrigger, PopoverContent } from "@/ui/popover";
import { Button } from "@/ui/button";
import { Preferences } from "./Preferences";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";

/** Loaded on first use to keep the visitor's initial bundle small. */
export default function CompactPreferences() {
  useLocale();
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button className="secondary compact" />}>
        {m.visitor_preferences()}
      </PopoverTrigger>
      <PopoverContent
        aria-label={m.visitor_preferences()}
        align="end"
        className="w-travel-preferences-popup"
      >
        <Preferences />
      </PopoverContent>
    </Popover>
  );
}
