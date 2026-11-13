import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Field, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { useState } from "react";

import { SearchSelect } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { RecordDialog } from "../RecordDialog";
import type { TripSummary } from "../api-types";
import { emptyScope } from "../trips/publication/catalog";
import { LinkLifecycle } from "../trips/publication/LinkLifecycle";
import { RevealedLinkDialog } from "../trips/publication/RevealedLinkDialog";
import {
  collectionUrl,
  useCollectionMutations,
  useCollections,
  type CollectionMember,
} from "./collections";
import { MemberScopeDialog } from "./MemberScopeDialog";

/**
 * Creates or edits one collection link: its name and visitor title, its member trips (each with its own scope),
 * and its lifecycle. A new collection is a draft until it is activated.
 */
export function CollectionEditor({
  collectionId,
  trips,
  onClose,
}: {
  /** `null` while a new collection is being created. */
  collectionId: string | null;
  trips: TripSummary[];
  onClose: () => void;
}) {
  useLocale();
  const confirmation = useConfirmation();
  const collections = useCollections();
  const mutations = useCollectionMutations();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const id = collectionId ?? createdId;
  const collection = collections.data?.find((item) => item.id === id) ?? null;
  const [label, setLabel] = useState(collection?.label ?? "");
  const [title, setTitle] = useState(collection?.title ?? "");
  const [addTripId, setAddTripId] = useState("");
  const [editingMember, setEditingMember] = useState<CollectionMember | null>(null);
  const [revealed, setRevealed] = useState<{ label: string; url: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useFeedback<string | null>(null);
  const locked = collection?.state === "revoked" || collection?.state === "expired";
  const tripFor = (tripId: string) => trips.find((trip) => trip.id === tripId) ?? null;
  const available = trips.filter(
    (trip) => !collection?.members.some((member) => member.trip_id === trip.id),
  );
  const fail = (fallback: () => string) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));

  function saveDetails() {
    const values = { label: label.trim(), title: title.trim() || null };
    if (!values.label) return;
    if (!collection) {
      mutations.create.mutateAsync(values).then((created) => {
        setCreatedId(created.id);
        setNotice(textNotice(() => m.sharing_collection_created()));
      }, fail(m.sharing_collection_save_error));
    } else {
      mutations.update.mutateAsync({ id: collection.id, ...values }).then(() => {
        setNotice(textNotice(() => m.sharing_collection_saved()));
      }, fail(m.sharing_collection_save_error));
    }
  }

  function addTrip() {
    if (!collection || !addTripId) return;
    mutations.addMember
      .mutateAsync({ collectionId: collection.id, tripId: addTripId, scope: emptyScope() })
      .then((saved) => {
        setAddTripId("");
        const added = saved.members.find((member) => member.trip_id === addTripId);
        if (added) setEditingMember(added);
      }, fail(m.sharing_collection_save_error));
  }

  function removeTrip(member: CollectionMember) {
    if (!collection) return;
    confirmation.ask({
      title: () => m.sharing_remove_trip_title({ trip: member.trip_title }),
      description: () => m.sharing_remove_trip_description(),
      confirmLabel: () => m.sharing_remove_trip(),
      onConfirm: () =>
        mutations.removeMember
          .mutateAsync({ collectionId: collection.id, memberId: member.id })
          .then(() => undefined, fail(m.sharing_collection_action_error)),
    });
  }

  function activate(action: "activate" | "rotate") {
    if (!collection) return;
    mutations.activate
      .mutateAsync({ collection, action, expiresInDays, reason: reason.trim() || null })
      .then((result) => {
        mutations.activate.reset();
        if (result.token) setRevealed({ label: result.label, url: collectionUrl(result.token) });
      }, fail(m.sharing_the_secure_link_could_not_be_created));
  }

  function revoke() {
    if (!collection) return;
    confirmation.ask({
      title: () => m.sharing_revoke_named_link({ name: collection.label }),
      description: () =>
        m.sharing_anyone_with_the_current_secure_link_will_no_longer_be_able_to_open_the_h(),
      confirmLabel: () => m.sharing_revoke_link(),
      onConfirm: () =>
        mutations.revoke.mutateAsync({ collection, reason: reason.trim() || null }).then(() => {
          setNotice(textNotice(() => m.sharing_collection_revoked()));
        }, fail(m.sharing_the_link_could_not_be_revoked)),
    });
  }

  function deleteCollection() {
    if (!collection) return;
    confirmation.ask({
      title: () => m.sharing_delete_collection_title({ name: collection.label }),
      description: () => m.sharing_delete_collection_description(),
      confirmLabel: () => m.owner_delete(),
      onConfirm: () =>
        mutations.remove
          .mutateAsync({ id: collection.id })
          .then(onClose, fail(m.sharing_collection_action_error)),
    });
  }

  const editingTrip = editingMember ? tripFor(editingMember.trip_id) : null;
  return (
    <RecordDialog
      open
      title={
        collection ? `${m.sharing_editor_title()}: ${collection.label}` : m.sharing_editor_new()
      }
      onDismiss={onClose}
    >
      <div className="grid gap-4">
        {notice && <Alert role="status">{notice}</Alert>}
        <div className="grid gap-3">
          <Field>
            <FieldLabel>
              {m.sharing_collection_name()}
              <Input
                maxLength={120}
                value={label}
                disabled={locked}
                onChange={(event) => setLabel(event.target.value)}
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel>
              {m.sharing_collection_title()}
              <Input
                maxLength={160}
                value={title}
                disabled={locked}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FieldLabel>
            <p className="help">{m.sharing_collection_title_help()}</p>
          </Field>
          <div className="button-row">
            <Button
              type="button"
              disabled={
                locked || !label.trim() || mutations.create.isPending || mutations.update.isPending
              }
              onClick={saveDetails}
            >
              {m.sharing_save_collection()}
            </Button>
            {collection && collection.state !== "active" && (
              <Button className="danger" type="button" onClick={deleteCollection}>
                {m.sharing_delete_collection()}
              </Button>
            )}
          </div>
        </div>

        {collection && (
          <>
            <section className="grid gap-2" aria-label={m.sharing_members()}>
              <h3>{m.sharing_members()}</h3>
              {collection.members.length > 0 && (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {collection.members.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-travel-divider p-3"
                    >
                      <strong className="min-w-0 flex-1 wrap-anywhere">{member.trip_title}</strong>
                      {tripFor(member.trip_id) && (
                        <Button
                          className="secondary compact"
                          type="button"
                          aria-label={m.sharing_choose_scope_named({ trip: member.trip_title })}
                          onClick={() => setEditingMember(member)}
                        >
                          {m.sharing_choose_scope()}
                        </Button>
                      )}
                      {!locked && (
                        <Button
                          className="secondary compact"
                          type="button"
                          aria-label={m.sharing_remove_trip_named({
                            trip: member.trip_title,
                            name: collection.label,
                          })}
                          onClick={() => removeTrip(member)}
                        >
                          {m.sharing_remove_trip()}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!locked &&
                (available.length ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field>
                      <FieldLabel>{m.sharing_add_trip_choose()}</FieldLabel>
                      <SearchSelect
                        ariaLabel={m.sharing_add_trip_choose()}
                        value={addTripId}
                        onChange={setAddTripId}
                      >
                        <option value="" />
                        {available.map((trip) => (
                          <option key={trip.id} value={trip.id}>
                            {trip.title}
                          </option>
                        ))}
                      </SearchSelect>
                    </Field>
                    <Button
                      type="button"
                      disabled={!addTripId || mutations.addMember.isPending}
                      onClick={addTrip}
                    >
                      {m.sharing_add_trip()}
                    </Button>
                  </div>
                ) : (
                  <p className="help">{m.sharing_add_trip_none()}</p>
                ))}
              <p className="help">{m.sharing_add_trip_help()}</p>
            </section>
            <section className="grid gap-2">
              <p className="help">{m.sharing_collection_link_warning()}</p>
              {collection.state === "draft" && <p className="help">{m.sharing_draft_hint()}</p>}
              <LinkLifecycle
                link={collection}
                expiresInDays={expiresInDays}
                reason={reason}
                onExpiresInDaysChange={setExpiresInDays}
                onReasonChange={setReason}
                onActivate={activate}
                onShow={() =>
                  collection.token &&
                  setRevealed({ label: collection.label, url: collectionUrl(collection.token) })
                }
                onRevoke={revoke}
              />
            </section>
          </>
        )}
        <Button className="secondary justify-self-start" type="button" onClick={onClose}>
          {m.owner_close_2()}
        </Button>
      </div>
      {confirmation.dialog}
      {revealed && (
        <RevealedLinkDialog
          link={revealed}
          onCopy={() => {
            void navigator.clipboard.writeText(revealed.url);
            setNotice(textNotice(() => m.sharing_link_copied()));
          }}
          onClose={() => setRevealed(null)}
        />
      )}
      {collection && editingMember && editingTrip && (
        <MemberScopeDialog
          collection={collection}
          member={collection.members.find((item) => item.id === editingMember.id) ?? editingMember}
          trip={editingTrip}
          onClose={() => setEditingMember(null)}
        />
      )}
    </RecordDialog>
  );
}
