import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";

import { useConfirmation } from "../forms/useConfirmation";
import { bytesLabel, formatInstant, openBlobInNewTab } from "../tracker-model";
import { useOfflineCopies } from "./useOfflineCopies";
import type { OfflineCopySummary, OfflineResourceKind } from "./offline-store";
import { OfflineSnapshotView } from "./OfflineSnapshotView";
import { PackingOfflineView } from "../trips/PackingOfflineView";

const KIND_LABELS: Record<OfflineResourceKind, string> = {
  get library_document() {
    return m.assets_library_document();
  },
  get trip_document() {
    return m.assets_trip_document();
  },
  get emergency_info() {
    return m.assets_emergency_information();
  },
  get media_asset() {
    return m.owner_private_media();
  },
  get media_derivative() {
    return m.assets_media_copy_2();
  },
  get route_data() {
    return m.assets_map_and_route_data();
  },
  get visit() {
    return m.owner_visit();
  },
  get packing_list() {
    return m.assets_packing_list();
  },
};

const formatMoment = formatInstant;

export function OfflineManager() {
  useLocale();
  const confirmation = useConfirmation();
  const offline = useOfflineCopies();
  const [message, setMessage] = useFeedback<string>("");
  const [viewingText, setViewingText] = useState<{
    title: string;
    text: string;
    kind: OfflineResourceKind;
    id: string;
    subject: string;
    leaseExpiresAt: number;
  } | null>(null);
  const [viewingPacking, setViewingPacking] = useState<OfflineCopySummary | null>(null);

  useEffect(() => {
    if (!viewingText) return;
    const timer = window.setTimeout(
      () => setViewingText(null),
      Math.max(0, viewingText.leaseExpiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [viewingText]);

  useEffect(() => {
    setViewingText((current) => (current?.subject === offline.subject ? current : null));
    setViewingPacking((current) => (current?.subject === offline.subject ? current : null));
  }, [offline.subject]);

  if (!offline.subject) return null;

  async function view(copy: OfflineCopySummary) {
    setMessage("");
    if (copy.resourceKind === "packing_list") {
      setViewingPacking(copy);
      return;
    }
    try {
      const blob = await offline.open(copy.id);
      if (copy.contentType === "application/json") {
        setViewingText({
          title: copy.title,
          text: await blob.text(),
          kind: copy.resourceKind,
          id: copy.id,
          subject: offline.subject!,
          leaseExpiresAt: copy.leaseExpiresAt,
        });
        return;
      }
      openBlobInNewTab(blob);
    } catch (error) {
      setMessage(errorNotice(error, m.assets_the_offline_copy_could_not_be_opened));
    }
  }

  function remove(copy: OfflineCopySummary) {
    confirmation.ask({
      title: () => m.assets_stop_saving_offline({ p0: copy.title }),
      description: () => m.assets_the_copy_will_be_removed_from_this_device_the_original_is_kept(),
      confirmLabel: () => m.assets_stop_saving(),
      onConfirm: async () => {
        await offline.remove(copy.id);
        setMessage(textNotice(() => m.owner_is_no_longer_available_offline({ p0: copy.title })));
      },
    });
  }

  function clearAll() {
    confirmation.ask({
      title: () => m.assets_delete_all_offline_copies(),
      description: () => m.assets_this_only_clears_the_copies_on_this_device(),
      confirmLabel: () => m.assets_clear_all(),
      onConfirm: async () => {
        await offline.clearAll();
        setMessage(
          textNotice(() => m.assets_all_offline_copies_on_this_device_have_been_deleted()),
        );
      },
    });
  }

  const totalBytes = offline.copies.reduce((sum, copy) => sum + copy.byteSize, 0);

  return (
    <section className="travel-card manager" aria-labelledby="offline-title">
      <div className="capture-heading">
        <div>
          <h3 id="offline-title">{m.assets_offline()}</h3>
          <p>
            {m.assets_deliberately_saved_copies_stay_on_this_device_only_and_disappear_when_yo()}
          </p>
        </div>
        {offline.copies.length > 0 && (
          <Button className="danger compact" type="button" onClick={clearAll}>
            {m.assets_clear_all()}
          </Button>
        )}
      </div>
      <p className="help" role="status">
        {message ||
          (offline.unsupported && m.assets_offline_storage_is_not_supported_in_this_browser()) ||
          (!offline.online &&
            m.assets_you_are_offline_copies_will_be_checked_again_when_you_reconnect()) ||
          (offline.copies.length > 0
            ? m.assets_offline_copies_count({
                count: offline.copies.length,
                size: bytesLabel(totalBytes),
              })
            : m.assets_no_offline_copies_yet())}
      </p>
      {offline.disclosure?.exportable && (
        <p className="help">
          {m.assets_your_browser_cannot_store_the_offline_key_as_nonexportable_copies_use_be()}
        </p>
      )}
      {offline.persisted === false && (
        <p className="help">
          {m.assets_your_browser_has_not_granted_persistent_storage_for_these_offline_copies()}
        </p>
      )}
      {!offline.copies.length && offline.loaded && (
        <p>{m.assets_enable_save_offline_on_a_document_emergency_information_media_item_map_v()}</p>
      )}
      {offline.copies.length > 0 && (
        <div className="saved-records mt-0.5">
          {offline.copies.map((copy) => (
            <article className="excerpt-row" key={copy.id}>
              <div>
                <strong>{copy.title}</strong>
                <span>
                  {m.assets_last_checked_valid_until_line({
                    p0: KIND_LABELS[copy.resourceKind],
                    p1: bytesLabel(copy.byteSize),
                    p2: formatMoment(copy.lastValidatedAt),
                    p3: formatMoment(copy.leaseExpiresAt),
                  })}
                </span>
              </div>
              <div className="button-row">
                <Button className="secondary compact" type="button" onClick={() => void view(copy)}>
                  {m.assets_view()}
                </Button>
                <Button className="danger compact" type="button" onClick={() => remove(copy)}>
                  {m.owner_delete()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {viewingText &&
        viewingText.subject === offline.subject &&
        offline.copies.some((copy) => copy.id === viewingText.id) && (
          <div className="travel-card manager-subsection">
            <div className="capture-heading">
              <div>
                <h3>{viewingText.title}</h3>
              </div>
            </div>
            <OfflineSnapshotView kind={viewingText.kind} text={viewingText.text} />
            <Button
              className="secondary compact"
              type="button"
              onClick={() => setViewingText(null)}
            >
              {m.owner_close_2()}
            </Button>
          </div>
        )}
      {viewingPacking && offline.copies.some((copy) => copy.id === viewingPacking.id) && (
        <div className="rounded-xl border p-4">
          <PackingOfflineView copy={viewingPacking} open={offline.open} />
          <Button
            className="secondary compact mt-3"
            type="button"
            onClick={() => setViewingPacking(null)}
          >
            {m.owner_close_2()}
          </Button>
        </div>
      )}
      {confirmation.dialog}
    </section>
  );
}
