import { useEffect, useState } from "react";
import { formatInstant, formatNumber, formatRelativeTime, useLocale } from "./locale";
import type { CurrentLocation } from "./api-types";
import { m } from "./paraglide/messages.js";

/** Recheck age even when the visitor leaves a page open overnight. */
export function CurrentLocations({ positions }: { positions?: CurrentLocation[] | null }) {
  useLocale();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const current = positions?.filter((point) => clock < Date.parse(point.expires_at)) ?? [];
  if (!current.length) return null;
  return (
    <section className="grid gap-2 rounded-xl border p-3" aria-label={m.live_current()}>
      <h2>{m.live_current()}</h2>
      {current.map((point, index) => (
        <p key={index}>
          {formatNumber(point.latitude, { maximumFractionDigits: 8 })},{" "}
          {formatNumber(point.longitude, { maximumFractionDigits: 8 })} ·{" "}
          <time dateTime={point.observed_at} title={formatInstant(new Date(point.observed_at))}>
            {formatRelativeTime(new Date(point.observed_at), clock)}
          </time>{" "}
          ·{" "}
          {point.stale ||
          clock - Date.parse(point.observed_at) - point.delay_seconds * 1000 > 3600000
            ? m.live_stale()
            : m.live_current()}
          {" · "}
          {m.live_delay_value({
            count: point.delay_seconds / 60,
            minutes: formatNumber(point.delay_seconds / 60),
          })}
        </p>
      ))}
    </section>
  );
}

export default CurrentLocations;
