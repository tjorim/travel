import { readFileSync } from "node:fs";

export type Locale = "nl" | "en";
export const locales: Locale[] = ["nl", "en"];

const catalogues = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    ) as Record<string, PluralMessage | string>,
  ]),
) as Record<Locale, Record<string, PluralMessage | string>>;

type PluralMessage = { match: Record<string, string> }[];

/** A plain message from the shipped catalogue, so the checks follow copy changes instead of repeating strings. */
export function message(locale: Locale, key: string): string {
  const text = catalogues[locale][key];
  if (text === undefined) throw new Error(`Missing ${locale} message ${key}`);
  if (typeof text !== "string")
    throw new Error(`${locale} message ${key} has plural variants: use plural()`);
  return text;
}

/** The English/Dutch plural variant of a counted message: `one` for exactly 1, `other` otherwise. */
export function plural(locale: Locale, key: string, count: number): string {
  const text = catalogues[locale][key];
  if (text === undefined) throw new Error(`Missing ${locale} message ${key}`);
  if (typeof text === "string") return text;
  const variant = text[0]?.match[`countPlural=${count === 1 ? "one" : "other"}`];
  if (variant === undefined) throw new Error(`Missing ${locale} plural variant for ${key}`);
  return variant;
}
