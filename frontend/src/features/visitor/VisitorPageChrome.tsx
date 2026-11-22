import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";

/** A long authored title would otherwise fill the first screen at display size with no room between lines. */
export const LONG_TITLE_LENGTH = 40;
export const LONG_TITLE_CLASS =
  "text-travel-title-long leading-travel-title-long tracking-travel-title-long min-[680px]:max-w-none";

export function OwnerLink() {
  useLocale();
  return (
    <footer className="mt-10.5">
      <a
        className="font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
        href="/admin/"
        referrerPolicy="no-referrer"
      >
        {m.manage_trips()}
      </a>
    </footer>
  );
}
