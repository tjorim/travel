import { Button } from "@base-ui/react/button";

import { RecordForm } from "../../forms/fields";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { PublicProjectionStatus, ShareScope, Trip } from "../../tracker-model";
import { publicUrl, type CatalogItem } from "./catalog";
import { ScopeEditor } from "./ScopeEditor";

export type PublicValues = { scope: ShareScope };

/** The public page: what everyone can see, whether it is published, and the actions to view, publish or withdraw it. */
export function PublicSection({
  trip,
  status,
  record,
  catalog,
  toggling,
  onScopeChange,
  onError,
  onCopyLink,
  onPreview,
  onToggle,
}: {
  trip: Trip;
  status: PublicProjectionStatus | null;
  record: ReturnType<typeof useRecordForm<PublicValues, PublicProjectionStatus>>;
  catalog: CatalogItem[];
  toggling: boolean;
  onScopeChange: () => void;
  onError: (error: unknown) => void;
  onCopyLink: () => void;
  onPreview: () => void;
  onToggle: () => void;
}) {
  useLocale();
  const isPublished = status?.surface_state === "published";
  const slug = isPublished ? status?.slug : null;
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.assets_for_everyone()}</h3>
          <p>
            {isPublished
              ? m.assets_this_page_is_accessible_to_everyone()
              : m.assets_this_page_is_not_accessible_to_visitors_yet()}
          </p>
        </div>
      </div>
      {slug && (
        <p className="help">
          <code className="inline-block wrap-anywhere rounded-md bg-travel-tint px-2 py-1 text-sm text-travel-ink">
            {publicUrl(slug)}
          </code>
        </p>
      )}
      <RecordForm
        record={record}
        submitLabel={m.assets_save_selection()}
        pendingLabel={m.assets_saving()}
        actions={
          <>
            {slug && (
              <a
                className="action-link secondary"
                href={publicUrl(slug)}
                target="_blank"
                rel="noreferrer"
              >
                {m.assets_open_public_page()}
              </a>
            )}
            {slug && (
              <Button className="secondary" type="button" onClick={onCopyLink}>
                {m.assets_copy_link_2()}
              </Button>
            )}
            <Button className="secondary" type="button" onClick={onPreview}>
              {m.assets_view_as_visitor()}
            </Button>
            <Button
              className={isPublished ? "danger" : ""}
              type="button"
              disabled={!status || toggling}
              onClick={onToggle}
            >
              {isPublished ? m.assets_stop_sharing_with_everyone() : m.assets_share_with_everyone()}
            </Button>
          </>
        }
      >
        <record.form.Field name="scope">
          {(field) => (
            <ScopeEditor
              name={m.assets_what_everyone_can_see()}
              scope={field.state.value}
              setScope={(scope) => {
                field.handleChange(scope);
                onScopeChange();
              }}
              catalog={catalog}
              hasDates={Boolean(trip.starts_on)}
              tripId={trip.id}
              onError={onError}
            />
          )}
        </record.form.Field>
      </RecordForm>
    </div>
  );
}
