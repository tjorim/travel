import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { tripPath, useOwner } from "../../query/owner-queries";
import { ownerKeys } from "../../query/keys";
import type { ShareLink } from "../../tracker-model";
import { dateLabel } from "./catalog";

export function FeedControls({ tripId, link }: { tripId: string; link: ShareLink }) {
  useLocale();
  const owner = useOwner();
  const cache = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const [days, setDays] = useState(30);
  const mutation = useMutation({
    mutationFn: (action: string) =>
      ownerRequest<ShareLink>(
        owner!.session,
        tripPath(tripId, `share-links/${link.id}/feed/${action}`),
        m.feed_error,
        { method: "POST", body: { acknowledge_copies: acknowledged, expires_in_days: days } },
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ownerKeys.trip(owner!.subject, tripId) }),
  });
  if (link.state !== "active") return null;
  return (
    <section
      className="grid gap-2 rounded-travel-control border border-travel-divider p-3"
      aria-label={m.feed_heading()}
    >
      <h4>{m.feed_heading()}</h4>
      <p>{m.feed_warning()}</p>
      <Field>
        <FieldLabel className="scope-choice">
          <TravelCheckbox checked={acknowledged} onCheckedChange={setAcknowledged} />
          {m.feed_ack()}
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel>
          {m.assets_valid_for_days()}
          <Input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </FieldLabel>
      </Field>
      {link.feed_token && (
        <>
          <p>{m.feed_expiry({ date: dateLabel(link.feed_expires_at ?? null) })}</p>
          <Field>
            <FieldLabel>
              {m.feed_url()}
              <Input
                readOnly
                value={`${window.location.origin}/api/shared/${link.feed_token}/feed.atom`}
                onFocus={(event) => event.target.select()}
              />
            </FieldLabel>
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            !acknowledged || mutation.isPending || !Number.isInteger(days) || days < 1 || days > 90
          }
          onClick={() => mutation.mutate(link.feed_token ? "rotate" : "enable")}
        >
          {link.feed_token ? m.feed_rotate() : m.feed_enable()}
        </Button>
        {link.feed_token && (
          <Button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate("revoke");
            }}
          >
            {m.feed_revoke()}
          </Button>
        )}
      </div>
      {mutation.isError && <p role="alert">{m.feed_error()}</p>}
    </section>
  );
}
