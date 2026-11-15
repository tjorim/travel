import { createContext, useContext, type ReactNode } from "react";

import { selectedLocale } from "./locale";

/** The two languages authored text can be entered in (#376). */
export type ContentLanguage = "nl" | "en";

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ["nl", "en"];

export const otherLanguage = (language: ContentLanguage): ContentLanguage =>
  language === "nl" ? "en" : "nl";

/** The interface language as a content language: what a new trip is written in. */
export const interfaceLanguage = (): ContentLanguage => (selectedLocale() === "en" ? "en" : "nl");

const ContentLanguageContext = createContext<ContentLanguage | null>(null);

/** Says which language the trip around its children is written in; the owner's records follow it. */
export function ContentLanguageProvider({
  language,
  children,
}: {
  language: ContentLanguage | null | undefined;
  children: ReactNode;
}) {
  return (
    <ContentLanguageContext.Provider value={language ?? null}>
      {children}
    </ContentLanguageContext.Provider>
  );
}

/** The content language of the trip being edited; Dutch outside a trip, as the API treats an unset one. */
export function useContentLanguage(): ContentLanguage {
  return useContext(ContentLanguageContext) ?? "nl";
}

type Texts = { nl?: string | null; en?: string | null };

/** The text to show for `preferred`, else the other language's, and the language it is in (the API's rule). */
export function pickText(
  texts: Texts,
  preferred: ContentLanguage,
): { text: string; language: ContentLanguage } | null {
  for (const language of [preferred, otherLanguage(preferred)])
    if (texts[language]) return { text: texts[language], language };
  return null;
}

/** The language an authored text is actually in, for `lang`; undefined when the text is empty or unlabelled. */
export function authoredLanguage(
  record: object,
  field: string,
  preferred: ContentLanguage,
): ContentLanguage | undefined {
  const values = record as Record<string, unknown>;
  const nl = values[`${field}_nl`];
  const en = values[`${field}_en`];
  return pickText(
    {
      nl: typeof nl === "string" ? nl : null,
      en: typeof en === "string" ? en : null,
    },
    preferred,
  )?.language;
}

/** The language an owner's record shows `field` in (its trip's content language first), for `lang`. */
export function useAuthoredLang(record: object | null | undefined, field: string) {
  const preferred = useContentLanguage();
  const own = (record as { content_language?: ContentLanguage } | null | undefined)
    ?.content_language;
  return record ? authoredLanguage(record, field, own ?? preferred) : undefined;
}

/**
 * An element that shows one authored text of an owner's record in the language it is written in, so a screen
 * reader uses the right voice for it whatever the interface language is. A title the record lacks (a visit named
 * after its place, a route named after its ends) is not that text, so it carries no `lang`.
 */
export function AuthoredText({
  as: Element = "span",
  record,
  field,
  className,
  children,
}: {
  as?: "span" | "h1" | "h2" | "h3" | "h4" | "strong" | "p";
  record: object;
  field: string;
  className?: string;
  children: ReactNode;
}) {
  const lang = useAuthoredLang(record, field);
  return (
    <Element className={className} lang={lang}>
      {children}
    </Element>
  );
}
