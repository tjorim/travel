import { Button } from "@/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage, type ErrorFallback } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useOwner, useTripResource } from "../query/owner-queries";
import type { Projection } from "../ProjectionView";
import { RecordDialog } from "../RecordDialog";
import type { ShareLink, PublicProjectionStatus, ShareScope, Trip } from "../tracker-model";
import { cloneScope, emptyScope, publicUrl, shareUrl } from "./publication/catalog";
import { LinkLifecycle } from "./publication/LinkLifecycle";
import { LinkList, type LinkSeries } from "./publication/LinkList";
import { PreviewDialog, type Preview } from "./publication/PreviewDialog";
import { PublicSection, type PublicValues } from "./publication/PublicSection";
import { RevealedLinkDialog } from "./publication/RevealedLinkDialog";
import { ScopeEditor } from "./publication/ScopeEditor";
import { SharingReview, VisibilityOverview } from "./publication/SharingReview";
import { usePublicationCatalog } from "./publication/use-publication-catalog";
import { usePublicationMutations } from "./publication/use-publication-mutations";

type LinkValues = { label: string; scope: ShareScope };

export function PublicationManager({ trip }: { trip: Trip }) {
  useLocale();
  const confirmation = useConfirmation();
  const owner = useOwner();
  const statusQuery = useTripResource(trip.id, "public-projection");
  const linksQuery = useTripResource(trip.id, "share-links");
  const overviewQuery = useTripResource(trip.id, "overview");
  const { catalog, error: catalogError, derivativesError } = usePublicationCatalog(trip);
  const publicStatus = statusQuery.data ?? null;
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const linkSeries = useMemo<LinkSeries[]>(() => {
    const grouped = new Map<string, ShareLink[]>();
    for (const link of links)
      grouped.set(link.series_id || link.id, [
        ...(grouped.get(link.series_id || link.id) ?? []),
        link,
      ]);
    return [...grouped.entries()].map(([id, entries]) => {
      const current =
        entries.find((link) => link.state === "draft" || link.state === "active") ?? entries[0];
      return { id, current, history: entries.filter((link) => link.id !== current.id) };
    });
  }, [links]);

  // null: no link editor; `{ linkId: null }`: a new link is being drafted; otherwise the chosen link.
  const [linkEditor, setLinkEditor] = useState<{ linkId: string | null } | null>(null);
  const editingLinkId = linkEditor?.linkId ?? null;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [revealedLink, setRevealedLink] = useState<{ label: string; url: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [reason, setReason] = useState("");
  const {
    savePublic,
    previewPublicScope,
    togglePublic,
    saveLink,
    previewLinkScope,
    activate,
    revoke,
  } = usePublicationMutations(trip.id);

  const selectedLink = links.find((link) => link.id === editingLinkId) ?? null;
  const lockedLink = selectedLink?.state === "revoked" || selectedLink?.state === "expired";

  const publicRecord = useRecordForm<PublicValues, PublicProjectionStatus>({
    defaultValues: { scope: emptyScope() },
    fallback: m.assets_the_public_scope_could_not_be_saved,
    submit: (values) => savePublic.mutateAsync(values.scope),
    onSuccess: (saved) => {
      publicRecord.load({ scope: cloneScope(saved.scope) });
      setNotice(textNotice(() => m.assets_selection_saved_unselected_content_stays_private()));
    },
  });
  const linkRecord = useRecordForm<LinkValues, ShareLink>({
    defaultValues: { label: "", scope: emptyScope() },
    fallback: m.assets_the_share_link_could_not_be_saved,
    serverFields: { label: "label" },
    // Saving never activates: a new link is created as a draft the owner can preview, then activate explicitly.
    submit: (values) =>
      saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope }),
    onSuccess: (saved) => {
      const wasNew = editingLinkId === null;
      loadLink(saved);
      setNotice(
        textNotice(() =>
          wasNew
            ? m.assets_draft_saved_view_the_preview_and_activate_the_link_when_you_are_satisfie()
            : m.assets_share_link_and_scope_saved(),
        ),
      );
    },
  });

  // The public scope follows the server, but never overwrites edits that are not saved yet.
  const publicDirty = useRef(false);
  publicDirty.current = publicRecord.dirty;
  const serverScope = publicStatus?.scope;
  useEffect(() => {
    if (serverScope && !publicDirty.current) publicRecord.load({ scope: cloneScope(serverScope) });
    // `load` is stable; only a new server scope should reload the editor.
  }, [serverScope]);

  function loadLink(link: ShareLink) {
    setLinkEditor({ linkId: link.id });
    linkRecord.load({ label: link.label, scope: cloneScope(link.scope) });
    setPreview(null);
    setRevealedLink(null);
    setReason("");
  }

  function loadNewLink() {
    setLinkEditor({ linkId: null });
    linkRecord.load({ label: "", scope: emptyScope() });
    setPreview(null);
    setRevealedLink(null);
    setReason("");
  }

  function switchLinkEditor(next: ShareLink | null) {
    if (linkEditor?.linkId === (next?.id ?? null)) return;
    const open = () => (next ? loadLink(next) : loadNewLink());
    if (linkRecord.dirty) {
      confirmation.ask({
        title: () => m.assets_discard_unsaved_link_changes(),
        description: () => m.assets_the_name_and_scope_you_edited_will_not_be_saved(),
        confirmLabel: () => m.owner_discard_changes_2(),
        onConfirm: open,
      });
      return;
    }
    open();
  }

  function closeLinkEditor() {
    if (linkEditor === null) return;
    setLinkEditor(null);
    linkRecord.load({ label: "", scope: emptyScope() });
  }

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));

  async function previewPublic() {
    const values = publicRecord.form.state.values;
    const saved = await savePublic.mutateAsync(values.scope);
    publicRecord.load({ scope: cloneScope(saved.scope) });
    const document = await previewPublicScope.mutateAsync();
    setPreview({
      name: m.assets_public_preview,
      audience: "public",
      document: document as Projection,
    });
  }

  function toggle() {
    if (!publicStatus) return;
    const publish = publicStatus.surface_state !== "published";
    togglePublic.mutateAsync({ publish, reason: reason.trim() || null }).then(() => {
      setReason("");
      setNotice(
        textNotice(() =>
          publish ? m.assets_public_page_published() : m.assets_public_page_withdrawn(),
        ),
      );
    }, fail(m.assets_the_publication_status_could_not_be_changed));
  }

  async function previewLink() {
    let target = selectedLink;
    if (!target || !lockedLink) {
      const values = linkRecord.form.state.values;
      target = await saveLink.mutateAsync({
        id: editingLinkId,
        label: values.label.trim(),
        scope: values.scope,
      });
      loadLink(target);
    }
    const document = await previewLinkScope.mutateAsync(target);
    setLinkEditor(null);
    setPreview({
      name: () => m.assets_preview_of({ p0: target.label }),
      audience: "share",
      linkId: target.id,
      document: document as Projection,
    });
  }

  function activateLink(action: "activate" | "rotate") {
    if (!selectedLink) return;
    activate
      .mutateAsync({ link: selectedLink, action, expiresInDays, reason: reason.trim() || null })
      .then((result) => {
        activate.reset();
        loadLink(result);
        if (!result.token) {
          setNotice(textNotice(() => m.assets_the_link_could_not_be_created()));
          return;
        }
        setRevealedLink({ label: result.label, url: shareUrl(result.token) });
        setLinkEditor(null);
        setNotice(textNotice(() => m.assets_the_link_is_active_and_can_be_copied_again_later()));
      }, fail(m.assets_the_secure_link_could_not_be_created));
  }

  function revealCurrentLink() {
    if (!selectedLink?.token) return;
    setRevealedLink({ label: selectedLink.label, url: shareUrl(selectedLink.token) });
    setLinkEditor(null);
  }

  function revokeLink() {
    if (!selectedLink) return;
    confirmation.ask({
      title: () => m.assets_revoke_named_link({ name: selectedLink.label }),
      description: () =>
        m.assets_anyone_with_the_current_secure_link_will_no_longer_be_able_to_open_the_h(),
      confirmLabel: () => m.assets_revoke_link(),
      onConfirm: () =>
        revoke.mutateAsync({ link: selectedLink, reason: reason.trim() || null }).then((saved) => {
          loadLink(saved);
          setNotice(textNotice(() => m.assets_share_link_revoked()));
        }, fail(m.assets_the_link_could_not_be_revoked)),
    });
  }

  async function copyLink() {
    if (!revealedLink) return;
    await navigator.clipboard.writeText(revealedLink.url);
    setNotice(textNotice(() => m.assets_link_copied()));
  }

  async function copyPublicLink() {
    if (!publicStatus?.slug) return;
    await navigator.clipboard.writeText(publicUrl(publicStatus.slug));
    setNotice(textNotice(() => m.assets_public_link_copied()));
  }

  const readError =
    [statusQuery, linksQuery].find((query) => query.isError)?.error ??
    catalogError ??
    derivativesError;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.assets_your_publications_could_not_be_loaded)
      : statusQuery.isPending
        ? m.assets_loading_your_publications()
        : m.assets_choose_who_sees_each_item_new_items_are_private());
  const isPublished = publicStatus?.surface_state === "published";

  return (
    <section className="travel-card manager gap-4.5" aria-labelledby="publication-manager-title">
      <div className="capture-heading">
        <div>
          <h3 id="publication-manager-title">{m.owner_sharing()}</h3>
          <p>
            {m.assets_each_item_has_the_same_choice_private_everyone_or_select_per_audience_he()}
          </p>
        </div>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {revealedLink && (
        <RevealedLinkDialog
          link={revealedLink}
          onCopy={() => void copyLink().catch(fail(m.assets_copying_failed))}
          onClose={() => setRevealedLink(null)}
        />
      )}
      <SharingReview overview={overviewQuery.data} />
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h3>{m.assets_visibility_per_item()}</h3>
            <p>
              {m.assets_the_same_choice_as_in_each_items_editor_this_shows_a_setting_not_who_act()}
            </p>
          </div>
        </div>
        <VisibilityOverview tripId={trip.id} catalog={catalog} />
      </div>
      <PublicSection
        trip={trip}
        status={publicStatus}
        record={publicRecord}
        catalog={catalog}
        toggling={togglePublic.isPending}
        onScopeChange={() => setPreview(null)}
        onError={fail(m.owner_visibility_save_failed)}
        onCopyLink={() => void copyPublicLink().catch(fail(m.assets_copying_failed))}
        onPreview={() =>
          void previewPublic().catch(fail(m.assets_the_preview_could_not_be_loaded_2))
        }
        onToggle={toggle}
      />
      <LinkList
        series={linkSeries}
        hasLinks={links.length > 0}
        loading={linksQuery.isPending}
        editingLinkId={editingLinkId}
        onSelect={switchLinkEditor}
        onNew={() => switchLinkEditor(null)}
      />
      <RecordDialog
        open={linkEditor !== null}
        title={editingLinkId ? m.assets_edit_share_link() : m.assets_add_share_link()}
        dirty={linkRecord.dirty}
        onDismiss={closeLinkEditor}
      >
        {linkEditor !== null && (
          <div className="publication-panel">
            <RecordForm
              record={linkRecord}
              submitLabel={selectedLink ? m.assets_save_link() : m.assets_save_draft()}
              pendingLabel={m.owner_saving()}
              disabled={lockedLink}
              actions={
                <Button
                  className="secondary"
                  type="button"
                  disabled={lockedLink || !linkRecord.values.label.trim()}
                  onClick={() =>
                    void previewLink().catch(fail(m.assets_the_preview_could_not_be_loaded_2))
                  }
                >
                  {m.assets_view_preview()}
                </Button>
              }
            >
              <linkRecord.form.Field
                name="label"
                listeners={{ onChange: () => setPreview(null) }}
                validators={{
                  onChange: requiredText(m.owner_give_the_link_a_name),
                  onSubmit: requiredText(m.owner_give_the_link_a_name),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label={m.assets_link_name()}
                    required
                    maxLength={120}
                    disabled={lockedLink}
                    placeholder={m.assets_for_example_family()}
                  />
                )}
              </linkRecord.form.Field>
              <linkRecord.form.Field name="scope">
                {(field) => (
                  <ScopeEditor
                    name={m.assets_scope_for_hidden_link()}
                    scope={field.state.value}
                    setScope={(scope) => {
                      field.handleChange(scope);
                      setPreview(null);
                    }}
                    catalog={catalog}
                    hasDates={Boolean(trip.starts_on)}
                    tripId={trip.id}
                    onError={fail(m.owner_visibility_save_failed)}
                    disabled={lockedLink}
                  />
                )}
              </linkRecord.form.Field>
            </RecordForm>
            <LinkLifecycle
              link={selectedLink}
              expiresInDays={expiresInDays}
              reason={reason}
              onExpiresInDaysChange={setExpiresInDays}
              onReasonChange={setReason}
              onActivate={activateLink}
              onShow={revealCurrentLink}
              onRevoke={revokeLink}
            />
          </div>
        )}
      </RecordDialog>
      {preview && owner && (
        <PreviewDialog
          preview={preview}
          links={links}
          isPublished={isPublished}
          tripId={trip.id}
          session={owner.session}
          onClose={() => setPreview(null)}
        />
      )}
      {confirmation.dialog}
    </section>
  );
}
