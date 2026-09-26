import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { useConfirmation } from "../forms/useConfirmation";
import { errorMessage, ownerRequest } from "../query/api";
import { ownerKeys } from "../query/keys";
import { useOwnerMutation, useProviderConnections } from "../query/owner-queries";
import { EmptyState } from "../tracker-routes";
import type { ProviderConnectionStatus } from "../tracker-model";

const labels = { google_photos_picker: "Google Photos", gopro_cloud: "GoPro Cloud" } as const;
type Provider = ProviderConnectionStatus["provider"];
const providerPath = (provider: Provider) => `/api/provider-tokens/${provider}`;
const refreshProviders = (subject: string) => [ownerKeys.providers(subject)];

export function Settings() {
  const confirmation = useConfirmation();
  const { session } = useAuth();
  const providersQuery = useProviderConnections();
  const queryClient = useQueryClient();
  const providers = (providersQuery.data ?? []).filter((item) => item.available);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const completed = useRef(false);
  const revoke = useOwnerMutation<Provider>({
    fallback: "De provider kon niet worden losgekoppeld.",
    request: (provider) => ({ path: providerPath(provider), method: "DELETE" }),
    invalidate: refreshProviders,
  });

  useEffect(() => {
    if (!session || completed.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("state")) return;
    completed.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.get("error")) { setNotice("Google Photos heeft de verbinding niet toegestaan."); return; }
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) { setNotice("De Google Photos-verbinding is onvolledig."); return; }
    setConnecting(true);
    void ownerRequest<void>(session, "/api/provider-tokens/google_photos_picker/oauth/complete", "Google Photos kon niet worden verbonden.", {
      method: "POST", body: { code, state },
    }).then(() => {
      setNotice("Google Photos is verbonden voor private imports.");
      const key = ownerKeys.providers(decodeSubject(session.accessToken) ?? "");
      void queryClient.cancelQueries({ queryKey: key }).then(() => queryClient.invalidateQueries({ queryKey: key }));
    }, (error: unknown) => setNotice(errorMessage(error, "Google Photos kon niet worden verbonden.")))
      .finally(() => setConnecting(false));
  }, [session, queryClient]);

  async function connectGoogle() {
    if (!session) return;
    setConnecting(true);
    try {
      const result = await ownerRequest<{ authorization_url: string }>(session, "/api/provider-tokens/google_photos_picker/oauth/start", "Google Photos kon niet worden gestart.", { method: "POST" });
      window.location.assign(result.authorization_url);
    } catch (error) {
      setNotice(errorMessage(error, "Google Photos kon niet worden gestart."));
      setConnecting(false);
    }
  }

  function disconnect(provider: Provider) {
    confirmation.ask({ title: `${labels[provider]} loskoppelen?`, description: "Bestaande geïmporteerde media blijven privé beschikbaar.", confirmLabel: "Loskoppelen", onConfirm: () => {
      revoke.mutateAsync(provider).then(() => setNotice(`${labels[provider]} is losgekoppeld.`), (error: unknown) => setNotice(errorMessage(error, "De provider kon niet worden losgekoppeld.")));
    } });
  }

  const message = notice ?? (providersQuery.error ? errorMessage(providersQuery.error, "De providerstatus kon niet worden geladen.") : providersQuery.isPending ? "Laad providerstatus…" : "Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd.");
  if (!session) return <EmptyState title="Instellingen">Meld aan om de status van je private mediaproviders te bekijken.</EmptyState>;

  return <section className="card manager" aria-labelledby="settings-title">
    <div><p className="eyebrow">Private accountinstellingen</p><h2 id="settings-title">Instellingen</h2><p>Verbind Google Photos om geselecteerde media privé te importeren.</p></div>
    <p className="help" role="status">{message}</p>
    <div className="saved-records manager-list">{providers.map((provider) => <article className="provider-row" key={provider.provider}><div><strong>{labels[provider.provider]}</strong><span>{provider.connected ? "Verbonden voor private import" : "Niet verbonden"}</span></div><div className="provider-actions"><span className={`provider-status ${provider.connected ? "connected" : "disconnected"}`}>{provider.connected ? "Verbonden" : "Niet verbonden"}</span>{provider.connected ? <button className="danger compact" type="button" onClick={() => disconnect(provider.provider)}>Loskoppelen</button> : provider.provider === "google_photos_picker" ? <button type="button" disabled={connecting} onClick={() => void connectGoogle()}>{connecting ? "Verbinden…" : "Verbinden met Google"}</button> : null}</div></article>)}</div>
    {confirmation.dialog}
  </section>;
}
