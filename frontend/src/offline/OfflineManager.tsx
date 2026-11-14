import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice } from "../query/feedback";
import { Button } from "@/ui/button";
import { useEffect, useState } from "react";

import { useConfirmation } from "../forms/useConfirmation";
import { bytesLabel, openBlobInNewTab } from "../files";
import { formatInstant } from "../dates";
import { useOfflineCopies } from "./useOfflineCopies";
import type { OfflineCopySummary, OfflineResourceKind } from "./offline-store";
import { OfflineSnapshotView } from "./OfflineSnapshotView";
import { PackingOfflineView } from "../trips/PackingOfflineView";

const KIND_LABELS: Record<OfflineResourceKind, string> = {
  get library_document() {
    return m.offline_library_document();
  },
  get trip_document() {
    return m.offline_trip_document();
  },
  get emergency_info() {
    return m.offline_emergency_information();
  },
  get media_asset() {
    return m.common_private_media();
  },
  get media_derivative() {
    return m.offline_media_copy_title();
  },
  get route_data() {
    return m.offline_map_and_route_data();
  },
  get visit() {
    return m.common_visit();
  },
  get packing_list() {
    return m.packing_list();
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
      setMessage(errorNotice(error, m.offline_the_offline_copy_could_not_be_opened));
    }
  }

  function remove(copy: OfflineCopySummary) {
    confirmation.ask({
      title: () => m.offline_stop_saving_offline({ title: copy.title }),
      description: () => m.offline_remove_description(),
      confirmLabel: () => m.offline_stop_saving(),
      onConfirm: async () => {
        await offline.remove(copy.id);
        setMessage(
          textNotice(() => m.common_is_no_longer_available_offline({ title: copy.title })),
        );
      },
    });
  }

  function clearAll() {
    confirmation.ask({
      title: () => m.offline_delete_all_offline_copies(),
      description: () => m.offline_this_only_clears_the_copies_on_this_device(),
      confirmLabel: () => m.offline_clear_all(),
      onConfirm: async () => {
        await offline.clearAll();
        setMessage(
          textNotice(() => m.offline_all_offline_copies_on_this_device_have_been_deleted()),
        );
      },
    });
  }

  const totalBytes = offline.copies.reduce((sum, copy) => sum + copy.byteSize, 0);

  return (
    <section className="travel-card manager" aria-labelledby="offline-title">
      <div className="capture-heading">
        <div>
          <h3 id="offline-title">{m.offline_offline()}</h3>
          <p>{m.offline_copies_device_only_hint()}</p>
        </div>
        {offline.copies.length > 0 && (
          <Button className="danger compact" type="button" onClick={clearAll}>
            {m.offline_clear_all()}
          </Button>
        )}
      </div>
      <p className="help" role="status">
        {message ||
          (offline.unsupported && m.offline_storage_is_not_supported_in_this_browser()) ||
          (!offline.online && m.offline_recheck_on_reconnect_notice()) ||
          (offline.copies.length > 0
            ? m.offline_copies_count({
                count: offline.copies.length,
                size: bytesLabel(totalBytes),
              })
            : m.offline_no_offline_copies_yet())}
      </p>
      {offline.disclosure?.exportable && (
        <p className="help">{m.offline_key_not_exportable_warning()}</p>
      )}
      {offline.persisted === false && (
        <p className="help">{m.offline_storage_not_persistent_warning()}</p>
      )}
      {!offline.copies.length && offline.loaded && <p>{m.offline_empty_hint()}</p>}
      {offline.copies.length > 0 && (
        <div className="saved-records mt-0.5">
          {offline.copies.map((copy) => (
            <article className="excerpt-row" key={copy.id}>
              <div className="grid gap-1">
                <strong>{copy.title}</strong>
                <span className="font-medium">
                  {m.offline_saved_line({ date: formatMoment(copy.pinnedAt) })}
                </span>
                <span>
                  {m.offline_copy_details({
                    kind: KIND_LABELS[copy.resourceKind],
                    size: bytesLabel(copy.byteSize),
                    checked: formatMoment(copy.lastValidatedAt),
                    expires: formatMoment(copy.leaseExpiresAt),
                  })}
                </span>
                {copy.newerVersionAvailable && (
                  <span role="status">{m.offline_newer_version_available()}</span>
                )}
              </div>
              <div className="button-row">
                <Button className="secondary compact" type="button" onClick={() => void view(copy)}>
                  {m.library_view()}
                </Button>
                <Button className="danger compact" type="button" onClick={() => remove(copy)}>
                  {m.common_delete()}
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
              {m.common_close()}
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
            {m.common_close()}
          </Button>
        </div>
      )}
      {confirmation.dialog}
    </section>
  );
}
