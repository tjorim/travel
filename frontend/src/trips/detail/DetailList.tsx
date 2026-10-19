import { useLocale } from "../../locale";

/** A block's records as a list, or the message for a block that has none. */
export function DetailList({
  empty,
  message,
  ordered = false,
  children,
}: {
  empty: boolean;
  message: string;
  ordered?: boolean;
  children: React.ReactNode;
}) {
  useLocale();
  if (empty) return <p>{message}</p>;
  return ordered ? (
    <ol className="travel-detail-list">{children}</ol>
  ) : (
    <div className="travel-detail-list">{children}</div>
  );
}
