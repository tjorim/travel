import { Button } from "@/ui/button";
import { Link } from "@tanstack/react-router";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useProviderConnections } from "../../query/owner-queries";
import type { ImportSession } from "../../api-types";
import { providerLabel } from "./labels";

/** Importing media from a connected provider: choose there, then copy the selection into the private trip. */
export function MediaImport({
  importSession,
  onStart,
  onFinish,
}: {
  importSession: ImportSession | null;
  onStart: (provider: ImportSession["provider"]) => void;
  onFinish: () => void;
}) {
  useLocale();
  // Only providers this server offers are shown; one the owner has not connected yet is disabled.
  const providers = (useProviderConnections().data ?? []).filter((item) => item.available);
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.media_import()}</h3>
          <p>
            {providers.length > 0 ? (
              <>
                {m.media_provider_settings()} <Link to="/settings">{m.settings()}</Link>
              </>
            ) : (
              m.media_provider_import_is_not_available_on_this_server_yet_you_can_upload_media()
            )}
          </p>
        </div>
      </div>
      {providers.length > 0 && (
        <div className="button-row">
          {providers.map((item) => (
            <Button
              key={item.provider}
              className="secondary"
              type="button"
              disabled={!item.connected}
              title={item.connected ? undefined : m.media_connect_in_settings_first()}
              onClick={() => onStart(item.provider)}
            >
              {m.media_choose_in_line({ p0: providerLabel[item.provider] })}
            </Button>
          ))}
        </div>
      )}
      {importSession && (
        <aside className="grid gap-2.25 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.5 text-sm leading-normal text-travel-warning-ink [&_.action-link]:w-fit [&_button]:w-fit">
          <strong>{m.media_selection_line({ p0: providerLabel[importSession.provider] })}</strong>
          <span>{m.media_first_choose_only_the_media_you_want_to_copy_to_this_private_trip()}</span>
          {importSession.picker_uri && (
            <a
              className="action-link"
              href={importSession.picker_uri}
              target="_blank"
              rel="noreferrer"
            >
              {m.media_open_selection()}
            </a>
          )}
          <Button type="button" onClick={onFinish}>
            {m.media_import_selection()}
          </Button>
        </aside>
      )}
    </div>
  );
}
