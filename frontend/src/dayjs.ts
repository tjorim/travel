/**
 * Centralized dayjs configuration. Import `dayjs` from here — never directly from the
 * `dayjs` package — so its locale and timezone plugins are loaded exactly once and shared
 * across the whole app.
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/nl";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("nl");

export { dayjs };
