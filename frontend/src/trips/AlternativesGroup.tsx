/** Ideas for the same journey or dates, shown together as alternatives under a label. */
export function AlternativesGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="border-l-2 border-travel-border pl-1">
      <p className="help font-bold">{label}</p>
      {children}
    </div>
  );
}
