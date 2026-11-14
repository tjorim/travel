import { Alert } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { useConfirmation } from "../forms/useConfirmation";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { ownerKeys } from "../query/keys";
import {
  tripPath,
  tripResourceQueryOptions,
  useOwner,
  useOwnerMutation,
  useTripsQuery,
} from "../query/owner-queries";
import type { ShareLink, TripSummary } from "../api-types";
import { sectionPath } from "../trips/workspace-sections";
import { dateLabel, LINK_STATE_LABELS, publicUrl, shareUrl } from "../trips/publication/catalog";
import { RevealedLinkDialog } from "../trips/publication/RevealedLinkDialog";
import { CollectionEditor } from "./CollectionEditor";
import {
  collectionUrl,
  lastChange,
  useCollectionMutations,
  useCollections,
  type Collection,
} from "./collections";

const SOON_MS = 7 * 24 * 60 * 60 * 1000;

type Warning = { key: string; message: string };

function expiringSoon(expiresAt: string | null, state: string): boolean {
  if (state !== "active" || !expiresAt) return false;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return remaining > 0 && remaining < SOON_MS;
}

function OpenInTrip({ tripId, name }: { tripId: string; name: string }) {
  useLocale();
  return (
    <Link
      className="inline-flex items-center px-1 font-bold text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
      to={sectionPath(tripId, "sharing")}
      aria-label={m.sharing_open_in_trip_named({ name })}
    >
      {m.sharing_open_in_trip()}
    </Link>
  );
}

function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <li
      aria-label={label}
      className="grid gap-2 rounded-xl border border-travel-divider p-3"
      data-record-row=""
    >
      {children}
    </li>
  );
}

function scopeParts(scope: Collection["members"][number]["scope"], records: number): string {
  const parts: string[] = [];
  if (scope.trip.title) parts.push(m.sharing_part_title());
  if (scope.trip.summary) parts.push(m.sharing_part_summary());
  if (scope.trip.dates) parts.push(m.sharing_part_dates());
  if (records > 0) parts.push(m.sharing_part_records({ count: records }));
  return parts.length ? parts.join(", ") : m.sharing_part_nothing();
}

/** One place for everything shared across all trips: public trips, hidden links and collection links. */
export function SharingOverview() {
  useLocale();
  const owner = useOwner();
  const confirmation = useConfirmation();
  const tripsQuery = useTripsQuery();
  const trips = useMemo<TripSummary[]>(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const collectionsQuery = useCollections();
  const collectionMutations = useCollectionMutations();
  const surfaces = useQueries({
    queries: trips.map((trip) => tripResourceQueryOptions(owner, trip.id, "public-projection")),
  });
  const linkLists = useQueries({
    queries: trips.map((trip) => tripResourceQueryOptions(owner, trip.id, "share-links")),
  });
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [revealed, setRevealed] = useState<{ label: string; url: string } | null>(null);

  const linkAction = useOwnerMutation<
    { tripId: string; link: ShareLink; action: "revoke" | "rotate" },
    ShareLink
  >({
    fallback: m.sharing_the_link_could_not_be_revoked,
    request: ({ tripId, link, action }) => ({
      path: tripPath(tripId, `share-links/${link.id}/${action}`),
      method: "POST",
      body: action === "rotate" ? { expires_in_days: 30, reason: null } : { reason: null },
    }),
    invalidate: (subject, { tripId }) => [
      ownerKeys.tripResource(subject, tripId, "share-links"),
      ownerKeys.tripResource(subject, tripId, "overview"),
      [...ownerKeys.trip(subject, tripId), "audit-events"],
    ],
    gcTime: 0,
  });

  const loading =
    tripsQuery.isPending ||
    collectionsQuery.isPending ||
    surfaces.some((query) => query.isPending) ||
    linkLists.some((query) => query.isPending);
  const loadError = [tripsQuery, collectionsQuery, ...surfaces, ...linkLists].find(
    (query) => query.isError,
  )?.error;

  const publicTrips = trips.flatMap((trip, index) => {
    const status = surfaces[index]?.data;
    return status?.surface_state === "published" && status.slug
      ? [{ trip, slug: status.slug }]
      : [];
  });
  const links = trips.flatMap((trip, index) =>
    (linkLists[index]?.data ?? [])
      .filter((link) => link.state !== "revoked")
      .map((link) => ({ trip, link })),
  );
  const collections = collectionsQuery.data ?? [];

  const warnings: Warning[] = [
    ...links.flatMap(({ trip, link }): Warning[] => {
      const name = `${link.label} (${trip.title})`;
      if (link.state === "expired")
        return [{ key: `l-${link.id}`, message: m.sharing_warning_expired({ name }) }];
      return expiringSoon(link.expires_at, link.state)
        ? [
            {
              key: `l-${link.id}`,
              message: m.sharing_warning_expiring({ name, date: dateLabel(link.expires_at) }),
            },
          ]
        : [];
    }),
    ...collections.flatMap((collection): Warning[] => {
      const found: Warning[] = [];
      if (collection.state === "expired")
        found.push({
          key: `c-${collection.id}`,
          message: m.sharing_warning_expired({ name: collection.label }),
        });
      else if (expiringSoon(collection.expires_at, collection.state))
        found.push({
          key: `c-${collection.id}`,
          message: m.sharing_warning_expiring({
            name: collection.label,
            date: dateLabel(collection.expires_at),
          }),
        });
      if (collection.state !== "revoked" && collection.state !== "expired") {
        if (!collection.members.length)
          found.push({
            key: `ce-${collection.id}`,
            message: m.sharing_warning_empty_collection({ name: collection.label }),
          });
        for (const member of collection.members)
          if (member.delivered_records === 0)
            found.push({
              key: `cm-${member.id}`,
              message: m.sharing_warning_empty_member({
                trip: member.trip_title,
                name: collection.label,
              }),
            });
      }
      return found;
    }),
  ];

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setNotice(textNotice(() => m.sharing_link_copied()));
  }

  function revokeLink(trip: TripSummary, link: ShareLink) {
    confirmation.ask({
      title: () => m.sharing_revoke_named_link({ name: link.label }),
      description: () => m.sharing_rotate_warning(),
      confirmLabel: () => m.sharing_revoke_link(),
      onConfirm: () =>
        linkAction.mutateAsync({ tripId: trip.id, link, action: "revoke" }).then(
          () => setNotice(textNotice(() => m.sharing_share_link_revoked())),
          (error: unknown) =>
            setNotice(errorNotice(error, m.sharing_the_link_could_not_be_revoked)),
        ),
    });
  }

  function rotateLink(trip: TripSummary, link: ShareLink) {
    confirmation.ask({
      title: () => m.sharing_rotate_title({ name: link.label }),
      description: () => m.sharing_rotate_description(),
      confirmLabel: () => m.sharing_rotate(),
      onConfirm: () =>
        linkAction.mutateAsync({ tripId: trip.id, link, action: "rotate" }).then(
          (result) =>
            result.token && setRevealed({ label: result.label, url: shareUrl(result.token) }),
          (error: unknown) =>
            setNotice(errorNotice(error, m.sharing_the_secure_link_could_not_be_created)),
        ),
    });
  }

  function revokeCollection(collection: Collection) {
    confirmation.ask({
      title: () => m.sharing_revoke_named_link({ name: collection.label }),
      description: () => m.sharing_rotate_warning(),
      confirmLabel: () => m.sharing_revoke_link(),
      onConfirm: () =>
        collectionMutations.revoke.mutateAsync({ collection, reason: null }).then(
          () => setNotice(textNotice(() => m.sharing_collection_revoked())),
          (error: unknown) =>
            setNotice(errorNotice(error, m.sharing_the_link_could_not_be_revoked)),
        ),
    });
  }

  function rotateCollection(collection: Collection) {
    confirmation.ask({
      title: () => m.sharing_rotate_title({ name: collection.label }),
      description: () => m.sharing_rotate_description(),
      confirmLabel: () => m.sharing_rotate(),
      onConfirm: () =>
        collectionMutations.activate
          .mutateAsync({ collection, action: "rotate", expiresInDays: 30, reason: null })
          .then(
            (result) => {
              collectionMutations.activate.reset();
              if (result.token)
                setRevealed({ label: result.label, url: collectionUrl(result.token) });
            },
            (error: unknown) =>
              setNotice(errorNotice(error, m.sharing_the_secure_link_could_not_be_created)),
          ),
    });
  }

  const nothing = !publicTrips.length && !links.length && !collections.length;

  return (
    <section className="grid gap-5" aria-labelledby="sharing-overview-title">
      <div>
        <p className="travel-eyebrow">{m.common_sharing()}</p>
        <h2 id="sharing-overview-title">{m.sharing_overview()}</h2>
        <p>{m.sharing_overview_intro()}</p>
      </div>
      {notice && <Alert role="status">{notice}</Alert>}
      {loading && !loadError && (
        <p className="flex items-center gap-2" role="status">
          <Spinner />
          {m.sharing_loading()}
        </p>
      )}
      {loadError && (
        <Alert variant="error" role="alert">
          {errorMessage(loadError, m.sharing_load_error)}
        </Alert>
      )}
      {!loading && !loadError && warnings.length > 0 && (
        <section aria-labelledby="sharing-warnings" className="grid gap-2">
          <h3 id="sharing-warnings">{m.sharing_warnings()}</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {warnings.map((warning) => (
              <li key={warning.key}>
                <Alert>{warning.message}</Alert>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!loading && !loadError && nothing && (
        <div className="travel-card" role="status">
          <h3>{m.sharing_nothing_shared()}</h3>
          <p>{m.sharing_nothing_shared_description()}</p>
        </div>
      )}

      {!loading && !loadError && (
        <>
          <section aria-labelledby="sharing-public" className="grid gap-2">
            <h3 id="sharing-public">{m.sharing_public_trips()}</h3>
            {publicTrips.length === 0 ? (
              <p className="help">{m.sharing_public_none()}</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {publicTrips.map(({ trip, slug }) => (
                  <Row key={trip.id} label={trip.title}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 flex-1 wrap-anywhere">{trip.title}</strong>
                      <Badge variant="live">{m.sharing_state_live()}</Badge>
                    </div>
                    <div className="button-row">
                      <OpenInTrip tripId={trip.id} name={trip.title} />
                      <Button
                        className="secondary compact"
                        type="button"
                        aria-label={m.sharing_copy_link_named({ name: trip.title })}
                        onClick={() => void copy(publicUrl(slug))}
                      >
                        {m.common_copy_link()}
                      </Button>
                    </div>
                  </Row>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sharing-links" className="grid gap-2">
            <h3 id="sharing-links">{m.sharing_unlisted_links()}</h3>
            {links.length === 0 ? (
              <p className="help">{m.sharing_unlisted_none()}</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {links.map(({ trip, link }) => (
                  <Row key={link.id} label={`${link.label} (${trip.title})`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 flex-1 wrap-anywhere">
                        {link.label} · {trip.title}
                      </strong>
                      <Badge variant={link.state === "active" ? "live" : "offline"}>
                        {LINK_STATE_LABELS[link.state]}
                      </Badge>
                    </div>
                    <p className="help m-0">
                      {link.expires_at
                        ? m.sharing_expires({ date: dateLabel(link.expires_at) })
                        : m.sharing_no_expiry()}
                      {" · "}
                      {m.sharing_last_change({ date: dateLabel(lastChange({ ...link })) })}
                    </p>
                    <div className="button-row">
                      <OpenInTrip tripId={trip.id} name={`${link.label} · ${trip.title}`} />
                      {link.state === "active" && link.token && (
                        <Button
                          className="secondary compact"
                          type="button"
                          aria-label={m.sharing_copy_link_named({ name: link.label })}
                          onClick={() => void copy(shareUrl(link.token!))}
                        >
                          {m.common_copy_link()}
                        </Button>
                      )}
                      {link.state === "active" && (
                        <>
                          <Button
                            className="secondary compact"
                            type="button"
                            aria-label={m.sharing_rotate_named({ name: link.label })}
                            onClick={() => rotateLink(trip, link)}
                          >
                            {m.sharing_rotate()}
                          </Button>
                          <Button
                            className="danger compact"
                            type="button"
                            aria-label={m.sharing_revoke_named({ name: link.label })}
                            onClick={() => revokeLink(trip, link)}
                          >
                            {m.sharing_revoke()}
                          </Button>
                        </>
                      )}
                    </div>
                  </Row>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sharing-collections" className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="sharing-collections" className="m-0 flex-1">
                {m.sharing_collections()}
              </h3>
              <Button
                className="secondary compact"
                type="button"
                onClick={() => setEditor({ id: null })}
              >
                {m.sharing_new_collection()}
              </Button>
            </div>
            <p className="help m-0">{m.sharing_collections_intro()}</p>
            {collections.length === 0 ? (
              <p className="help">{m.sharing_collections_none()}</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {collections.map((collection) => (
                  <Row key={collection.id} label={collection.label}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 flex-1 wrap-anywhere">{collection.label}</strong>
                      <Badge variant={collection.state === "active" ? "live" : "offline"}>
                        {LINK_STATE_LABELS[collection.state]}
                      </Badge>
                    </div>
                    <p className="help m-0">
                      {m.sharing_trip_count({ count: collection.members.length })}
                      {" · "}
                      {collection.expires_at
                        ? m.sharing_expires({ date: dateLabel(collection.expires_at) })
                        : m.sharing_no_expiry()}
                      {" · "}
                      {m.sharing_last_change({ date: dateLabel(lastChange(collection)) })}
                    </p>
                    {collection.members.length > 0 && (
                      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                        {collection.members.map((member) => (
                          <li key={member.id}>
                            <strong>{member.trip_title}</strong>
                            {" · "}
                            {member.delivered_records === 0 &&
                            !member.scope.trip.title &&
                            !member.scope.trip.summary &&
                            !member.scope.trip.dates
                              ? m.sharing_member_nothing()
                              : m.sharing_member_shows({
                                  parts: scopeParts(member.scope, member.delivered_records),
                                })}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="button-row">
                      <Button
                        className="secondary compact"
                        type="button"
                        aria-label={m.sharing_edit_collection({ name: collection.label })}
                        onClick={() => setEditor({ id: collection.id })}
                      >
                        {m.sharing_edit()}
                      </Button>
                      {collection.state === "active" && collection.token && (
                        <Button
                          className="secondary compact"
                          type="button"
                          aria-label={m.sharing_copy_link_named({ name: collection.label })}
                          onClick={() => void copy(collectionUrl(collection.token!))}
                        >
                          {m.common_copy_link()}
                        </Button>
                      )}
                      {collection.state === "active" && (
                        <>
                          <Button
                            className="secondary compact"
                            type="button"
                            aria-label={m.sharing_rotate_named({ name: collection.label })}
                            onClick={() => rotateCollection(collection)}
                          >
                            {m.sharing_rotate()}
                          </Button>
                          <Button
                            className="danger compact"
                            type="button"
                            aria-label={m.sharing_revoke_named({ name: collection.label })}
                            onClick={() => revokeCollection(collection)}
                          >
                            {m.sharing_revoke()}
                          </Button>
                        </>
                      )}
                    </div>
                  </Row>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {confirmation.dialog}
      {revealed && (
        <RevealedLinkDialog
          link={revealed}
          onCopy={() => void copy(revealed.url)}
          onClose={() => setRevealed(null)}
        />
      )}
      {editor && (
        <CollectionEditor collectionId={editor.id} trips={trips} onClose={() => setEditor(null)} />
      )}
    </section>
  );
}
