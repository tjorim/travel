import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { defineCustomClientStrategy, setLocale, type Locale } from "./paraglide/runtime.js";
import { m } from "./paraglide/messages.js";
import { ChoiceGroup } from "@/ui/ChoiceGroup";

export function resolveLocale(stored: unknown, languages: readonly string[]): Locale {
  if (stored === "nl" || stored === "en") return stored;
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "nl" || base === "en") return base;
  }
  return "nl";
}
function initialLocale(): Locale {
  if (typeof document === "undefined") return "nl";
  const early = document.documentElement.dataset.travelLocale;
  if (early === "nl" || early === "en") return early;
  let stored: unknown;
  try {
    stored = localStorage.getItem("travel-locale");
  } catch {
    /* Storage is optional. */
  }
  return resolveLocale(
    stored,
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
let current = initialLocale();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const selectedLocale = () => current;
defineCustomClientStrategy("custom-travel", {
  getLocale: selectedLocale,
  setLocale: (next) => {
    if (next !== "nl" && next !== "en") return;
    current = next;
    try {
      localStorage.setItem("travel-locale", next);
    } catch {
      /* Keep the in-memory choice. */
    }
  },
});
function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  document.documentElement.dataset.travelLocale = current;
  document.title = `Travel · ${window.location.pathname.startsWith("/admin") ? m.trips() : window.location.pathname.startsWith("/share/") ? m.shared_trip() : window.location.pathname.startsWith("/trips/") ? m.public_trip() : m.on_the_road()}`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", m.description());
}
export function changeLocale(next: Locale) {
  setLocale(next, { reload: false });
  updateDocument();
  window.dispatchEvent(new Event("travel-locale-change"));
  listeners.forEach((listener) => listener());
}
updateDocument();
const LocaleContext = createContext<Locale>(current);
export function LocaleBoundary({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, selectedLocale);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  useContext(LocaleContext);
  return useSyncExternalStore(subscribe, selectedLocale);
}
export function LocaleControl() {
  const locale = useLocale();
  return (
    <ChoiceGroup
      label={m.language()}
      value={locale}
      choices={[
        { value: "nl", label: "Nederlands" },
        { value: "en", label: "English" },
      ]}
      onChange={changeLocale}
    />
  );
}
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(current, options).format(value);
export const formatDate = (value: Date, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(current, options).format(value);
/** An absolute instant in the viewer's zone, always labelled with that zone ("9 Nov 2026, 14:05 CET"). dateStyle/timeStyle cannot be combined with timeZoneName. */
export const formatInstant = (value: Date) =>
  formatDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
/** How long before `now` a UTC instant was, in the selected locale ("now", "12 minutes ago", "2 hours ago"). Zone-free. */
export function formatRelativeTime(value: Date, now: number = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - value.getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(current, { numeric: "auto" });
  if (seconds < 60) return formatter.format(0, "second");
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), "hour");
  return formatter.format(-Math.floor(seconds / 86400), "day");
}
