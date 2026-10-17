import { readFileSync } from "node:fs";

export type Locale = "nl" | "en";
export const locales: Locale[] = ["nl", "en"];

const catalogues = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    ) as Record<string, string>,
  ]),
) as Record<Locale, Record<string, string>>;

/** A plain message from the shipped catalogue, so the checks follow copy changes instead of repeating strings. */
export function message(locale: Locale, key: string): string {
  const text = catalogues[locale][key];
  if (text === undefined) throw new Error(`Missing ${locale} message ${key}`);
  return text;
}
