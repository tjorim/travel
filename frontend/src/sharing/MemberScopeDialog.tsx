import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { useState } from "react";

import { useAuth } from "../auth-context";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { Projection } from "../ProjectionView";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { RecordDialog } from "../RecordDialog";
import type { ExclusionWidening, ShareScope, TripSummary } from "../api-types";
import { RenderedPreview } from "../trips/RenderedPreview";
import { cloneScope } from "../trips/publication/catalog";
import {
  ExclusionWideningDialog,
  exclusionWidening,
} from "../trips/publication/ExclusionWideningDialog";
import { ScopeEditor } from "../trips/publication/ScopeEditor";
import type { PresetAppliedAudience } from "../trips/publication/use-sharing-presets";
import { usePublicationCatalog } from "../trips/publication/use-publication-catalog";
import {
  collectionsPath,
  useCollectionMutations,
  type Collection,
  type CollectionMember,
} from "./collections";

/** Chooses what one member trip shows inside a collection, with a preview of the unsaved choice. */
export function MemberScopeDialog({
  collection,
  member,
  trip,
  onClose,
}: {
  collection: Collection;
  member: CollectionMember;
  trip: TripSummary;
  onClose: () => void;
}) {
  useLocale();
  const { session } = useAuth();
  const { catalog } = usePublicationCatalog(trip);
  const { setMemberScope, previewMember } = useCollectionMutations();
  const [scope, setScope] = useState<ShareScope>(() => cloneScope(member.scope));
  // What the member holds on the server; the editor has unsaved edits when its scope differs.
  const dirty = JSON.stringify(scope) !== JSON.stringify(cloneScope(member.scope));
  // Applying a preset rewrites the member on the server, so the editor takes the scope the server answers with.
  const adopt = (saved: PresetAppliedAudience) =>
    setScope(cloneScope((saved as CollectionMember).scope));
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [preview, setPreview] = useState<{ document: Projection; scope: ShareScope } | null>(null);
  const locked = collection.state === "revoked" || collection.state === "expired";
  // Saving would show an active collection's visitors more (an exclusion was removed); the owner confirms first.
  const [widening, setWidening] = useState<ExclusionWidening | null>(null);

  async function showPreview() {
    const candidate = cloneScope(scope);
    try {
      const document = await previewMember.mutateAsync({
        collectionId: collection.id,
        memberId: member.id,
        scope: candidate,
      });
      setPreview({ document: document as Projection, scope: candidate });
    } catch (error) {
      setNotice(errorNotice(error, m.sharing_the_link_preview_could_not_be_loaded));
    }
  }

  async function save(confirmWidening = false) {
    try {
      await setMemberScope.mutateAsync({
        collectionId: collection.id,
        member,
        scope,
        confirmWidening,
      });
      setNotice(textNotice(() => m.sharing_scope_saved()));
    } catch (error) {
      const found = exclusionWidening(error);
      if (found) setWidening(found);
      else setNotice(errorNotice(error, m.sharing_collection_save_error));
    }
  }

  return (
    <RecordDialog
      open
      title={m.sharing_scope_dialog_title({ trip: member.trip_title, name: collection.label })}
      className="max-w-280"
      onDismiss={onClose}
    >
      <div className="grid gap-3">
        <p className="help">{m.sharing_scope_help()}</p>
        {notice && <Alert role="status">{notice}</Alert>}
        <ScopeEditor
          scope={scope}
          setScope={setScope}
          name={member.trip_title}
          catalog={catalog}
          hasDates={Boolean(trip.starts_on || trip.ends_on)}
          tripId={trip.id}
          disabled={locked}
          allowExclusions
          preset={{
            target: { kind: "member", collectionId: collection.id, memberId: member.id },
            revision: () => member.revision,
            label: member,
            dirty,
            onApplied: adopt,
            onReload: adopt,
          }}
          onError={(error) => setNotice(errorNotice(error, m.sharing_collection_save_error))}
        />
        <div className="button-row">
          <Button
            type="button"
            disabled={locked || setMemberScope.isPending}
            onClick={() => void save()}
          >
            {m.sharing_save_scope()}
          </Button>
          <Button
            className="secondary"
            type="button"
            disabled={previewMember.isPending}
            onClick={() => void showPreview()}
          >
            {m.sharing_preview()}
          </Button>
          <Button className="secondary" type="button" onClick={onClose}>
            {m.owner_close_2()}
          </Button>
        </div>
        {widening && (
          <ExclusionWideningDialog
            widening={widening}
            onCancel={() => setWidening(null)}
            onConfirm={() => {
              setWidening(null);
              void save(true);
            }}
          />
        )}
        {preview && session && (
          <>
            <p className="help">{m.sharing_preview_unsaved_note()}</p>
            <RenderedPreview
              projection={preview.document}
              audience="share"
              tripId={trip.id}
              scope={preview.scope}
              session={session}
              previewBase={`${collectionsPath}/${encodeURIComponent(collection.id)}/members/${encodeURIComponent(member.id)}/preview`}
            />
          </>
        )}
      </div>
    </RecordDialog>
  );
}
