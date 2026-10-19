/** A private suggestion read from a linked photo or candidate; nothing in it is saved until the owner acts. */
export function SuggestionAside({ children }: { children: React.ReactNode }) {
  return (
    <aside className="grid gap-2 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.25 text-sm leading-normal text-travel-warning-ink [&_span]:text-travel-warning-muted">
      {children}
    </aside>
  );
}
