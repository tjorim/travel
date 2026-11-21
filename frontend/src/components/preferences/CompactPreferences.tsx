import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PreferencesPanel } from "./PreferencesPanel";
import { m } from "@/paraglide/messages.js";
import { useLocale } from "@/i18n/locale";

/** Loaded on first use to keep the visitor's initial bundle small. */
export default function CompactPreferences() {
  useLocale();
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button className="secondary compact" />}>
        {m.visitor_preferences()}
      </PopoverTrigger>
      <PreferencesPanel label={m.visitor_preferences()} />
    </Popover>
  );
}
