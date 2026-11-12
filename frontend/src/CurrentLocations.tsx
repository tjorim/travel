import { useEffect, useState } from "react";
import { formatDate, formatNumber, useLocale } from "./locale";
import { m } from "./paraglide/messages.js";

export type CurrentLocation = {
  delay_seconds?: number;
  expires_at?: string;
  latitude: number;
  longitude: number;
  observed_at: string;
  stale: boolean;
  precision: "exact" | "1km" | "10km";
};

/** Recheck age even when the visitor leaves a page open overnight. */
export function CurrentLocations({ positions }: { positions?: CurrentLocation[] | null }) {
  useLocale();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const current =
    positions?.filter(
      (point) =>
        clock <
        (point.expires_at
          ? Date.parse(point.expires_at)
          : Date.parse(point.observed_at) + 86400000),
    ) ?? [];
  if (!current.length) return null;
  return (
    <section className="grid gap-2 rounded-xl border p-3" aria-label={m.live_current()}>
      <h2>{m.live_current()}</h2>
      {current.map((point, index) => (
        <p key={index}>
          {formatNumber(point.latitude, { maximumFractionDigits: 8 })},{" "}
          {formatNumber(point.longitude, { maximumFractionDigits: 8 })} ·{" "}
          {formatDate(new Date(point.observed_at), { dateStyle: "medium", timeStyle: "short" })} ·{" "}
          {point.stale ||
          clock - Date.parse(point.observed_at) - (point.delay_seconds ?? 0) * 1000 > 3600000
            ? m.live_stale()
            : m.live_current()}
          {" · "}
          {m.live_delay_value({
            count: (point.delay_seconds ?? 0) / 60,
            minutes: formatNumber((point.delay_seconds ?? 0) / 60),
          })}
        </p>
      ))}
    </section>
  );
}

export default CurrentLocations;
