import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ShareLink } from "../../tracker-model";
import { dateLabel, LINK_STATE_LABELS } from "./catalog";

export type LinkSeries = { id: string; current: ShareLink; history: ShareLink[] };

/** The hidden share links, each series as its current link with earlier versions folded away. */
export function LinkList({
  series,
  hasLinks,
  loading,
  editingLinkId,
  onSelect,
  onNew,
}: {
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
          <h3>{m.assets_hidden_share_links()}</h3>
          <p>{m.assets_each_link_has_its_own_live_scope_and_can_later_be_revoked_or_rotated()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={onNew}>
          {m.assets_new_link()}
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
                  {m.assets_expires_line({
                    p0: LINK_STATE_LABELS[current.state],
                    p1: dateLabel(current.expires_at),
                    p2: history.length ? m.assets_previous({ count: history.length }) : "",
                  })}
                </span>
              </Button>
              {history.length > 0 && (
                <Collapsible.Root className="border-l-2 border-travel-divider pl-3">
                  <Collapsible.Trigger className="bg-transparent p-0 text-left text-sm font-bold text-travel-muted">
                    {m.assets_previous_view_line({
                      p0: history.length,
                      p1: history.length === 1 ? "versie" : "versies",
                    })}
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
      {!hasLinks && !loading && (
        <p>{m.assets_no_share_links_yet_choose_new_link_to_create_a_hidden_link_with_its_own_()}</p>
      )}
    </div>
  );
}
