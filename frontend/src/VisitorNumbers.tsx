import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import type { VisitorNumber, VisitorNumbers as Numbers } from "./tracker-model";

export const numberLabels: Record<VisitorNumber, () => string> = {
  days: m.numbers_days,
  areas: m.numbers_areas,
  countries: m.numbers_countries,
  nights: m.numbers_nights,
};

/** The server already computed these from the exact audience document. */
export function VisitorNumbers({ numbers }: { numbers?: Numbers }) {
  const locale = useLocale();
  if (!numbers || !Object.keys(numbers).length) return null;
  return (
    <section aria-label={m.numbers_heading()} className="grid gap-2">
      <dl className="m-0 flex flex-wrap gap-4">
        {(Object.keys(numberLabels) as VisitorNumber[]).map((key) =>
          numbers[key] !== undefined ? (
            <div key={key} className="grid gap-1">
              <dt className="text-sm text-travel-muted">{numberLabels[key]()}</dt>
              <dd className="m-0 text-xl font-bold">
                {new Intl.NumberFormat(locale).format(numbers[key]!)}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      <p className="m-0 text-sm text-travel-muted">{m.numbers_help()}</p>
    </section>
  );
}
