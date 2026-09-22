import { useEffect, useState } from "react";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { apiError, apiHeaders, type ProviderConnectionStatus } from "../tracker-model";

const labels = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

export function Settings() {
  const { session } = useAuth();
  const [providers, setProviders] = useState<ProviderConnectionStatus[]>([]);
  const [message, setMessage] = useState("Laad providerstatus…");

  useEffect(() => {
    if (!session) return;
    void fetch("/api/v1/provider-tokens", { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<ProviderConnectionStatus[]> : apiError(response, "De providerstatus kon niet worden geladen."))
      .then((loaded) => { setProviders(loaded); setMessage("Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd."); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De providerstatus kon niet worden geladen."));
  }, [session]);

  if (!session) return <EmptyState title="Instellingen">Meld aan om de status van je private mediaproviders te bekijken.</EmptyState>;

  return <section className="card manager" aria-labelledby="settings-title">
    <div><p className="eyebrow">Private accountinstellingen</p><h2 id="settings-title">Instellingen</h2><p>Providerverbindingen horen hier thuis. De toekomstige OAuth-koppeling uit #55 bouwt voort op deze statusweergave.</p></div>
    <p className="help" role="status">{message}</p>
    <div className="saved-moments manager-list">{providers.map((provider) => <article className="excerpt-row" key={provider.provider}><div><strong>{labels[provider.provider]}</strong><span>{provider.connected ? "Verbonden voor private import" : "Niet verbonden"}</span></div><span className={`provider-status ${provider.connected ? "connected" : "disconnected"}`}>{provider.connected ? "Verbonden" : "Niet verbonden"}</span></article>)}</div>
  </section>;
}
