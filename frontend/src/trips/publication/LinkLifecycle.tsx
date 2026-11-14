import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ShareLink } from "../../api-types";
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
  link: Pick<ShareLink, "state" | "token"> | null;
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
            {m.publication_valid_for_days()}
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
            {m.publication_no_expiry_date()}
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel>
            {m.publication_reason()}{" "}
            <span className="font-medium text-travel-optional">{m.common_optional()}</span>
            <Input
              maxLength={500}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </FieldLabel>
        </Field>
      </div>
      {expiresInDays === null && <p className="help">{m.publication_link_valid_hint()}</p>}
      {link?.state === "draft" && <p className="help">{m.publication_draft_inactive_hint()}</p>}
      <div className="button-row">
        {link?.state === "draft" && (
          <Button type="button" onClick={() => onActivate("activate")}>
            {m.publication_activate()}
          </Button>
        )}
        {link?.state === "active" && (
          <>
            <Button className="secondary" type="button" disabled={!link.token} onClick={onShow}>
              {m.publication_show_link()}
            </Button>
            <Button className="danger" type="button" onClick={onRevoke}>
              {m.sharing_revoke_link()}
            </Button>
            <Button type="button" onClick={() => onActivate("rotate")}>
              {m.publication_rotate_and_show_new_link()}
            </Button>
          </>
        )}
      </div>
      {link?.state === "active" && !link.token && (
        <p className="help">{m.publication_legacy_link_hint()}</p>
      )}
    </div>
  );
}
