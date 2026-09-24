import { useState } from "react";

import { useAuth } from "../auth-context";
import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { useOwnerMutation, useProviderConnections } from "../query/owner-queries";
import { EmptyState } from "../tracker-routes";
import type { ProviderConnectionStatus } from "../tracker-model";

const labels = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

type Provider = ProviderConnectionStatus["provider"];

const providerPath = (provider: Provider) => `/api/provider-tokens/${provider}`;
const refreshProviders = (subject: string) => [ownerKeys.providers(subject)];

function ConnectForm({ provider, onConnected }: { provider: Provider; onConnected: (provider: Provider) => void }) {
  // The token is a secret: the write is dropped from the mutation cache as soon as it settles.
  const connect = useOwnerMutation<string>({
    fallback: "De provider kon niet worden verbonden.",
    request: (accessToken) => ({ path: providerPath(provider), method: "PUT", body: { access_token: accessToken } }),
    invalidate: refreshProviders,
    gcTime: 0,
  });
  const record = useRecordForm<{ accessToken: string }>({
    defaultValues: { accessToken: "" },
    fallback: "De provider kon niet worden verbonden.",
    submit: async (values) => { await connect.mutateAsync(values.accessToken.trim()); connect.reset(); },
    onSuccess: () => { record.load({ accessToken: "" }); onConnected(provider); },
  });
  const needsToken = requiredText("Vul een toegangstoken in om deze tijdelijke koppeling te bewaren.");
  return <div className="provider-connect">
    <RecordForm record={record} submitLabel="Verbinden" pendingLabel="Verbinden…">
      <record.form.Field name="accessToken" validators={{ onChange: needsToken, onSubmit: needsToken }}>{(field) => <TextField field={field} label="Toegangstoken" optional="(tijdelijk, tot #55)" required type="password" autoComplete="off" />}</record.form.Field>
    </RecordForm>
  </div>;
}

export function Settings() {
  const { session } = useAuth();
  const providersQuery = useProviderConnections();
  const providers = providersQuery.data ?? [];
  const [notice, setNotice] = useState<string | null>(null);
  const revoke = useOwnerMutation<Provider>({
    fallback: "De provider kon niet worden losgekoppeld.",
    request: (provider) => ({ path: providerPath(provider), method: "DELETE" }),
    invalidate: refreshProviders,
  });

  function disconnect(provider: Provider) {
    if (!window.confirm(`${labels[provider]} loskoppelen? Bestaande geïmporteerde media blijven privé beschikbaar.`)) return;
    revoke.mutateAsync(provider).then(() => setNotice(`${labels[provider]} is losgekoppeld.`), (error: unknown) => setNotice(errorMessage(error, "De provider kon niet worden losgekoppeld.")));
  }

  const message = notice ?? (providersQuery.error ? errorMessage(providersQuery.error, "De providerstatus kon niet worden geladen.") : providersQuery.isPending ? "Laad providerstatus…" : "Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd.");

  if (!session) return <EmptyState title="Instellingen">Meld aan om de status van je private mediaproviders te bekijken.</EmptyState>;

  return <section className="card manager" aria-labelledby="settings-title">
    <div><p className="eyebrow">Private accountinstellingen</p><h2 id="settings-title">Instellingen</h2><p>Providerverbindingen horen hier thuis. De toekomstige OAuth-koppeling uit #55 bouwt voort op deze statusweergave.</p></div>
    <p className="help" role="status">{message}</p>
    <div className="saved-moments manager-list">{providers.map((provider) => <article className="provider-row" key={provider.provider}><div><strong>{labels[provider.provider]}</strong><span>{provider.connected ? "Verbonden voor private import" : "Niet verbonden"}</span></div><div className="provider-actions"><span className={`provider-status ${provider.connected ? "connected" : "disconnected"}`}>{provider.connected ? "Verbonden" : "Niet verbonden"}</span>{provider.connected ? <button className="danger compact" type="button" onClick={() => disconnect(provider.provider)}>Loskoppelen</button> : <ConnectForm provider={provider.provider} onConnected={(connected) => setNotice(`${labels[connected]} is verbonden voor private imports. Het token is niet terug te lezen of lokaal bewaard.`)} />}</div></article>)}</div>
  </section>;
}
