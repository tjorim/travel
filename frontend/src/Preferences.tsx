import { Popover, PopoverTrigger, PopoverContent } from "@/ui/popover";
import { Button } from "@/ui/button";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { AppearanceControl } from "./appearance";
import { LocaleControl } from "./locale";

/** Language and appearance in one wrapping row, placed at the top of a page shell so it lines up with the page. */
export function Preferences({ compact = false }: { compact?: boolean }) {
  useLocale();
  if (compact)
    return (
      <Popover>
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
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <LocaleControl />
      <AppearanceControl />
    </div>
  );
}
