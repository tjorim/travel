import { useEffect, useState, type FormEvent } from "react";

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

  async function loadProviders() {
    if (!session) return;
    const response = await fetch("/api/v1/provider-tokens", { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De providerstatus kon niet worden geladen.");
    const loaded = await response.json() as ProviderConnectionStatus[];
    setProviders(loaded);
    setMessage("Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd.");
  }

  useEffect(() => {
    if (!session) return;
    void loadProviders()
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De providerstatus kon niet worden geladen."));
  }, [session]);

  async function connect(event: FormEvent<HTMLFormElement>, provider: ProviderConnectionStatus["provider"]) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    const accessToken = String(form.get("access-token") ?? "").trim();
    if (!accessToken) { setMessage("Vul een toegangstoken in om deze tijdelijke koppeling te bewaren."); return; }
    const response = await fetch(`/api/v1/provider-tokens/${provider}`, {
      method: "PUT", headers: apiHeaders(session), body: JSON.stringify({ access_token: accessToken }),
    });
    if (!response.ok) return apiError(response, "De provider kon niet worden verbonden.");
    event.currentTarget.reset();
    await loadProviders();
    setMessage(`${labels[provider]} is verbonden voor private imports. Het token is niet terug te lezen of lokaal bewaard.`);
  }

  async function revoke(provider: ProviderConnectionStatus["provider"]) {
    if (!session || !window.confirm(`${labels[provider]} loskoppelen? Bestaande geïmporteerde media blijven privé beschikbaar.`)) return;
    const response = await fetch(`/api/v1/provider-tokens/${provider}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De provider kon niet worden losgekoppeld.");
    await loadProviders();
    setMessage(`${labels[provider]} is losgekoppeld.`);
  }

  if (!session) return <EmptyState title="Instellingen">Meld aan om de status van je private mediaproviders te bekijken.</EmptyState>;

  return <section className="card manager" aria-labelledby="settings-title">
    <div><p className="eyebrow">Private accountinstellingen</p><h2 id="settings-title">Instellingen</h2><p>Providerverbindingen horen hier thuis. De toekomstige OAuth-koppeling uit #55 bouwt voort op deze statusweergave.</p></div>
    <p className="help" role="status">{message}</p>
    <div className="saved-moments manager-list">{providers.map((provider) => <article className="provider-row" key={provider.provider}><div><strong>{labels[provider.provider]}</strong><span>{provider.connected ? "Verbonden voor private import" : "Niet verbonden"}</span></div><div className="provider-actions"><span className={`provider-status ${provider.connected ? "connected" : "disconnected"}`}>{provider.connected ? "Verbonden" : "Niet verbonden"}</span>{provider.connected ? <button className="danger compact" type="button" onClick={() => void revoke(provider.provider).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De provider kon niet worden losgekoppeld."))}>Loskoppelen</button> : <form className="provider-connect" onSubmit={(event) => void connect(event, provider.provider).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De provider kon niet worden verbonden."))}><label>Toegangstoken <span className="optional">(tijdelijk, tot #55)</span><input required name="access-token" type="password" autoComplete="off" /></label><button className="compact" type="submit">Verbinden</button></form>}</div></article>)}</div>
  </section>;
}
