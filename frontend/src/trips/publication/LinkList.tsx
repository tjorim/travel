import { FeedControls } from "./FeedControls";
import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ShareLink } from "../../api-types";
import { dateLabel, LINK_STATE_LABELS } from "./catalog";
import { presetLabelText } from "./PresetSection";

export type LinkSeries = { id: string; current: ShareLink; history: ShareLink[] };

/** The hidden share links, each series as its current link with earlier versions folded away. */
export function LinkList({
  tripId,
  series,
  hasLinks,
  loading,
  editingLinkId,
  onSelect,
  onNew,
}: {
  tripId?: string;
  series: LinkSeries[];
  hasLinks: boolean;
  loading: boolean;
  editingLinkId: string | null;
  onSelect: (link: ShareLink) => void;
  onNew: () => void;
}) {
  useLocale();
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.publication_hidden_share_links()}</h3>
          <p>{m.publication_links_intro()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={onNew}>
          {m.publication_new_link()}
        </Button>
      </div>
      {series.length > 0 && (
        <div className="grid gap-2">
          {series.map(({ id, current, history }) => (
            <div className="grid gap-2" key={id}>
              <Button
                type="button"
                className="link-row"
                data-selected={current.id === editingLinkId ? "" : undefined}
                onClick={() => onSelect(current)}
              >
                <strong>{current.label}</strong>
                <span>
                  {m.publication_link_expiry_line({
                    state: LINK_STATE_LABELS[current.state],
                    date: dateLabel(current.expires_at),
                    history: history.length
                      ? m.publication_previous({ count: history.length })
                      : "",
                  })}
                  {!!current.exclusions?.excluded.length &&
                    ` · ${m.exclusions_link_summary({ count: current.exclusions.excluded.length })}`}
                  {current.applied_preset &&
                    ` · ${presetLabelText(current.applied_preset, current.preset_exceptions?.count ?? 0)}`}
                </span>
              </Button>
              {tripId && <FeedControls tripId={tripId} link={current} />}
              {history.length > 0 && (
                <Collapsible.Root className="border-l-2 border-travel-divider pl-3">
                  <Collapsible.Trigger className="bg-transparent p-0 text-left text-sm font-bold text-travel-muted">
                    {m.publication_previous_view_line({ count: history.length })}
                  </Collapsible.Trigger>
                  <Collapsible.Panel keepMounted className="mt-2 grid gap-2">
                    {history.map((link) => (
                      <Button
                        type="button"
                        className="link-row"
                        data-selected={link.id === editingLinkId ? "" : undefined}
                        key={link.id}
                        onClick={() => onSelect(link)}
                      >
                        <strong>{link.label}</strong>
                        <span>
                          {LINK_STATE_LABELS[link.state]}{" "}
                          {dateLabel(link.revoked_at ?? link.expires_at)}
                        </span>
                      </Button>
                    ))}
                  </Collapsible.Panel>
                </Collapsible.Root>
              )}
            </div>
          ))}
        </div>
      )}
      {!hasLinks && !loading && <p>{m.publication_links_empty()}</p>}
    </div>
  );
}
