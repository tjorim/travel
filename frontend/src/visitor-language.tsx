import { createContext, useContext, type ReactNode } from "react";

import type { ContentLanguage } from "./content-language";

/**
 * The language a visitor document's unmarked authored texts are in (#376). The page never translates anything
 * itself: it asked for a language (or for the trip's own) and the server delivered each text in it, else in the
 * other one with a `<field>_lang` marker. This is what the page puts in `lang` so a screen reader uses the right
 * voice for authored text, whatever language the interface is in.
 */
const DocumentLanguage = createContext<ContentLanguage | null>(null);

export function DocumentLanguageProvider({
  language,
  children,
}: {
  language: ContentLanguage | null | undefined;
  children: ReactNode;
}) {
  return <DocumentLanguage.Provider value={language ?? null}>{children}</DocumentLanguage.Provider>;
}

/** The `lang` of one delivered text: its own marker when it is in the other language, else the document's. */
export function useTextLang(): (marker?: ContentLanguage | null) => ContentLanguage | undefined {
  const base = useContext(DocumentLanguage);
  return (marker) => marker ?? base ?? undefined;
}

/** Narrows a delivered `<field>_lang` value, which the API types as a plain union, to a content language. */
export const isContentLanguage = (value: unknown): value is ContentLanguage =>
  value === "nl" || value === "en";

/** `path` with the language a visitor asked for; unchanged without one, which means the trip's own language. */
export function withLanguage(path: string, language: ContentLanguage | null): string {
  if (!language) return path;
  return `${path}${path.includes("?") ? "&" : "?"}lang=${language}`;
}

/** The language the server says a document is in (`Content-Language`), when it is one of ours. */
export function deliveredLanguage(response: Response): ContentLanguage | null {
  const language = response.headers.get("Content-Language")?.toLowerCase().split("-")[0];
  return isContentLanguage(language) ? language : null;
}

/**
 * An element that shows an owner-authored text, marked with the language it is written in. `fallback` is the
 * interface's own phrase for a record without that text ("Visit"), which is in the interface language and so
 * gets no `lang` of its own.
 */
export function Authored({
  as: Element = "span",
  of,
  marker,
  fallback,
  className,
}: {
  as?: "span" | "h1" | "h2" | "h3" | "p";
  /** The delivered text, or null when there is none. */
  of: string | null;
  /** The `<field>_lang` the server delivered with it, when it is in the other language. */
  marker?: string | null;
  fallback: string;
  className?: string;
}) {
  const lang = useTextLang();
  return (
    <Element
      className={className}
      lang={of ? lang(isContentLanguage(marker) ? marker : null) : undefined}
    >
      {of ?? fallback}
    </Element>
  );
}
