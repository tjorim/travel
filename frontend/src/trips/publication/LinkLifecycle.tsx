import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ShareLink } from "../../tracker-model";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";

/** The expiry and reason a link is activated, rotated or revoked with, and the lifecycle actions for its state. */
export function LinkLifecycle({
  link,
  expiresInDays,
  reason,
  onExpiresInDaysChange,
  onReasonChange,
  onActivate,
  onShow,
  onRevoke,
}: {
  link: ShareLink | null;
  expiresInDays: number | null;
  reason: string;
  onExpiresInDaysChange: (days: number | null) => void;
  onReasonChange: (reason: string) => void;
  onActivate: (action: "activate" | "rotate") => void;
  onShow: () => void;
  onRevoke: () => void;
}) {
  useLocale();
  return (
    <div className="publication-panel">
      <div className="field-row">
        <Field className="contents">
          <FieldLabel>
            {m.assets_valid_for_days()}
            <Input
              type="number"
              min="1"
              max="90"
              disabled={expiresInDays === null}
              value={expiresInDays ?? 30}
              onChange={(event) => onExpiresInDaysChange(Number(event.target.value))}
            />
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="scope-choice">
            <TravelCheckbox
              checked={expiresInDays === null}
              onCheckedChange={(checked) => onExpiresInDaysChange(checked ? null : 30)}
            />
            {m.assets_no_expiry_date()}
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel>
            {m.assets_reason()}{" "}
            <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
            <Input
              maxLength={500}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </FieldLabel>
        </Field>
      </div>
      {expiresInDays === null && (
        <p className="help">{m.assets_this_link_remains_valid_until_you_revoke_or_rotate_it()}</p>
      )}
      {link?.state === "draft" && (
        <p className="help">
          {m.assets_this_draft_is_not_active_yet_view_the_preview_and_click_activate_when_yo()}
        </p>
      )}
      <div className="button-row">
        {link?.state === "draft" && (
          <Button type="button" onClick={() => onActivate("activate")}>
            {m.assets_activate()}
          </Button>
        )}
        {link?.state === "active" && (
          <>
            <Button className="secondary" type="button" disabled={!link.token} onClick={onShow}>
              {m.assets_show_link()}
            </Button>
            <Button className="danger" type="button" onClick={onRevoke}>
              {m.assets_revoke_link()}
            </Button>
            <Button type="button" onClick={() => onActivate("rotate")}>
              {m.assets_rotate_and_show_new_link()}
            </Button>
          </>
        )}
      </div>
      {link?.state === "active" && !link.token && (
        <p className="help">
          {m.assets_this_older_link_is_still_active_but_its_url_was_not_saved_rotate_it_once()}
        </p>
      )}
    </div>
  );
}
