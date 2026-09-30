/**
 * Centralized dayjs configuration. Import `dayjs` from here — never directly from the
 * `dayjs` package — so its locale and timezone plugins are loaded exactly once and shared
 * across the whole app.
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/nl";
import "dayjs/locale/en";
import { selectedLocale } from "./locale";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale(selectedLocale());
if (typeof window !== "undefined")
  window.addEventListener("travel-locale-change", () => dayjs.locale(selectedLocale()));

export { dayjs };
