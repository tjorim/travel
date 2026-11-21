import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { useRef, useState } from "react";

import { useAuth } from "@/app/providers/auth-context";
import type { ContentLanguage } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import type { Projection } from "@/components/projection/ProjectionView";
import { errorNotice, textNotice, useFeedback } from "@/lib/api/feedback";
import { RecordDialog } from "@/components/RecordDialog";
import type { ExclusionWidening, ShareScope, TripSummary } from "@/api-types";
import { RenderedPreview } from "@/components/projection/RenderedPreview";
import { cloneScope } from "@/features/trips/publication/catalog";
import {
  ExclusionWideningDialog,
  exclusionWidening,
} from "@/features/trips/publication/ExclusionWideningDialog";
import { ScopeEditor } from "@/features/trips/publication/ScopeEditor";
import { FutureDisclosureReview } from "@/features/trips/publication/SharingReview";
import {
  useFutureDisclosure,
  useRefreshFutureDisclosure,
} from "@/features/trips/publication/use-future-disclosure";
import type { PresetAppliedAudience } from "@/features/trips/publication/use-sharing-presets";
import { usePublicationCatalog } from "@/features/trips/publication/use-publication-catalog";
import {
  collectionsPath,
  useCollectionMutations,
  type Collection,
  type CollectionMember,
} from "./collections";

/** What the previewed scope would show of a trip that has not started yet, worded as the link preview words it. */
function MemberFutureDisclosure({
  collection,
  member,
  tripId,
  scope,
}: {
  collection: Collection;
  member: CollectionMember;
  tripId: string;
  scope: ShareScope;
}) {
  useLocale();
  const future = useFutureDisclosure(
    tripId,
    { kind: "member", collectionId: collection.id, memberId: member.id },
    scope,
  );
  return (
    <FutureDisclosureReview
      review={future}
      name={m.publication_collection_member({ name: collection.label })}
    />
  );
}

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
  const refreshFutureDisclosure = useRefreshFutureDisclosure(trip.id);
  const [scope, setScope] = useState<ShareScope>(() => cloneScope(member.scope));
  // What the member holds on the server; the editor has unsaved edits when its scope differs.
  const dirty = JSON.stringify(scope) !== JSON.stringify(cloneScope(member.scope));
  // Applying a preset rewrites the member on the server, so the editor takes the scope the server answers with.
  const adopt = (saved: PresetAppliedAudience) =>
    setScope(cloneScope((saved as CollectionMember).scope));
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [preview, setPreview] = useState<{
    document: Projection;
    scope: ShareScope;
    language: ContentLanguage;
  } | null>(null);
  const locked = collection.state === "revoked" || collection.state === "expired";
  // Saving would show an active collection's visitors more (an exclusion was removed); the owner confirms first.
  const [widening, setWidening] = useState<ExclusionWidening | null>(null);

  /** The preview of the candidate scope: in the trip's own language, or in `language` once the owner asks for one. */
  // Only the latest request may answer: an earlier one that resolves late would put its language back.
  const latestPreview = useRef(0);
  async function showPreview(language?: ContentLanguage) {
    const request = ++latestPreview.current;
    // Reading it in the other language shows the same candidate, not whatever the editor holds by now.
    const candidate = language && preview ? preview.scope : cloneScope(scope);
    try {
      const document = await previewMember.mutateAsync({
        collectionId: collection.id,
        memberId: member.id,
        scope: candidate,
        language,
      });
      if (request !== latestPreview.current) return;
      setPreview({
        document: document as Projection,
        scope: candidate,
        language: language ?? trip.content_language ?? "nl",
      });
      // The review counts the same server state as this preview, also when the scope did not change since the last one.
      void refreshFutureDisclosure();
    } catch (error) {
      if (request === latestPreview.current)
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
            {m.common_preview()}
          </Button>
          <Button className="secondary" type="button" onClick={onClose}>
            {m.common_close()}
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
            <MemberFutureDisclosure
              collection={collection}
              member={member}
              tripId={trip.id}
              scope={preview.scope}
            />
            <p className="help">{m.sharing_preview_unsaved_note()}</p>
            <ChoiceGroup
              label={m.publication_preview_language_label()}
              value={preview.language}
              choices={[
                { value: "nl", label: m.localized_dutch() },
                { value: "en", label: m.localized_english() },
              ]}
              onChange={(next) => void showPreview(next)}
            />
            <p className="help">{m.publication_preview_language_hint()}</p>
            <RenderedPreview
              projection={preview.document}
              language={preview.language}
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
