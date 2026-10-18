import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { Button } from "@base-ui/react/button";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { accountUrl, decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { useConfirmation } from "../forms/useConfirmation";
import { ownerRequest } from "../query/api";
import { ownerKeys } from "../query/keys";
import { useOwnerMutation, useProviderConnections } from "../query/owner-queries";
import { EmptyState } from "../ui/EmptyState";
import type { ProviderConnectionStatus } from "../tracker-model";

const labels = { google_photos_picker: "Google Photos", gopro_cloud: "GoPro Cloud" } as const;
type Provider = ProviderConnectionStatus["provider"];
const providerPath = (provider: Provider) => `/api/provider-tokens/${provider}`;
const refreshProviders = (subject: string) => [ownerKeys.providers(subject)];

export function Settings() {
  useLocale();
  const confirmation = useConfirmation();
  const { session } = useAuth();
  const providersQuery = useProviderConnections();
  const queryClient = useQueryClient();
  const providers = (providersQuery.data ?? []).filter((item) => item.available);
  const [notice, setNotice] = useState<(() => string) | null>(null);
  const [connecting, setConnecting] = useState(false);
  const completed = useRef(false);
  const revoke = useOwnerMutation<Provider>({
    fallback: m.provider_revoke_error(),
    request: (provider) => ({ path: providerPath(provider), method: "DELETE" }),
    invalidate: refreshProviders,
  });

  useEffect(() => {
    if (!session || completed.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("state")) return;
    completed.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.get("error")) {
      setNotice(() => () => m.provider_denied());
      return;
    }
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setNotice(() => () => m.provider_incomplete());
      return;
    }
    setConnecting(true);
    void ownerRequest<void>(
      session,
      "/api/provider-tokens/google_photos_picker/oauth/complete",
      m.provider_connect_error(),
      {
        method: "POST",
        body: { code, state },
      },
    )
      .then(
        () => {
          setNotice(() => () => m.provider_connected_notice());
          const key = ownerKeys.providers(decodeSubject(session.accessToken) ?? "");
          void queryClient
            .cancelQueries({ queryKey: key })
            .then(() => queryClient.invalidateQueries({ queryKey: key }));
        },
        () => setNotice(() => () => m.provider_connect_error()),
      )
      .finally(() => setConnecting(false));
  }, [session, queryClient]);

  async function connectGoogle() {
    if (!session) return;
    setConnecting(true);
    try {
      const result = await ownerRequest<{ authorization_url: string }>(
        session,
        "/api/provider-tokens/google_photos_picker/oauth/start",
        m.provider_start_error(),
        { method: "POST" },
      );
      window.location.assign(result.authorization_url);
    } catch {
      setNotice(() => () => m.provider_start_error());
      setConnecting(false);
    }
  }

  function disconnect(provider: Provider) {
    confirmation.ask({
      title: () => m.disconnect_title({ provider: labels[provider] }),
      description: () => m.disconnect_description(),
      confirmLabel: () => m.disconnect(),
      onConfirm: () => {
        revoke.mutateAsync(provider).then(
          () => setNotice(() => () => m.disconnected_notice({ provider: labels[provider] })),
          () => setNotice(() => () => m.provider_revoke_error()),
        );
      },
    });
  }

  const noProvidersAvailable = providersQuery.isSuccess && providers.length === 0;
  // With nothing to connect, the intro already explains why, so the status line stays empty unless there is news.
  const message =
    notice?.() ??
    (providersQuery.error
      ? m.provider_status_error()
      : providersQuery.isPending
        ? m.provider_loading()
        : noProvidersAvailable
          ? ""
          : m.provider_privacy());
  if (!session) return <EmptyState title={m.settings()}>{m.settings_signed_out()}</EmptyState>;

  return (
    <section className="grid gap-4.5" aria-labelledby="settings-title">
      <div>
        <p className="travel-eyebrow">{m.private_settings()}</p>
        <h2 id="settings-title">{m.settings()}</h2>
        <p>{noProvidersAvailable ? m.no_providers() : m.provider_intro()}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.25" hidden={!message}>
        <p className="help" role="status">
          {message}
        </p>
        {providersQuery.isError && !notice ? (
          <Button type="button" className="compact" onClick={() => void providersQuery.refetch()}>
            {m.retry()}
          </Button>
        ) : null}
      </div>
      {noProvidersAvailable ? null : (
        <div className="saved-records">
          {providers.map((provider) => (
            <article
              className="grid gap-3 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 shadow-sm [&>div:first-child]:grid [&>div:first-child]:gap-1"
              key={provider.provider}
            >
              <div>
                <strong>{labels[provider.provider]}</strong>
                <span className="text-sm font-medium text-travel-muted">
                  {provider.connected ? m.connected_import() : m.not_connected()}
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-2.25">
                <span
                  className="provider-status"
                  data-connected={provider.connected ? "" : undefined}
                >
                  {provider.connected ? m.connected() : m.not_connected()}
                </span>
                {provider.connected ? (
                  <Button
                    className="danger compact"
                    type="button"
                    onClick={() => disconnect(provider.provider)}
                  >
                    {m.disconnect()}
                  </Button>
                ) : provider.provider === "google_photos_picker" ? (
                  <Button type="button" disabled={connecting} onClick={() => void connectGoogle()}>
                    {connecting ? m.connecting() : m.connect_google()}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <article
        className="grid gap-3 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 shadow-sm"
        aria-labelledby="account-security-title"
      >
        <h3 id="account-security-title">{m.account_security_title()}</h3>
        <p className="help">{m.account_security_intro()}</p>
        <div className="flex flex-wrap items-end gap-2.25">
          <Button type="button" onClick={() => window.location.assign(accountUrl())}>
            {m.account_security_manage()}
          </Button>
        </div>
      </article>
      {confirmation.dialog}
    </section>
  );
}
