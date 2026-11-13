import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { CollectionMembershipResponse } from "../api-types";
import { ownerKeys } from "../query/keys";
import { ownerFile, ownerRequest } from "../query/api";
import { useOwner, useTripResource } from "../query/owner-queries";
import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { saveFile } from "./save-file";
import { Collapsible } from "@/ui/collapsible";
import { Field, FieldLabel } from "@/ui/field";

export function TripPdfExport({ tripId }: { tripId: string }) {
  const locale = useLocale();
  const owner = useOwner();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [view, setView] = useState("");
  const [audience, setAudience] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const links = useTripResource(open ? tripId : null, "share-links");
  const surface = useTripResource(open ? tripId : null, "public-projection");
  const memberships = useQuery({
    queryKey: [...ownerKeys.trip(owner?.subject ?? "", tripId), "collections"],
    enabled: open && owner !== null,
    queryFn: ({ signal }) =>
      ownerRequest<CollectionMembershipResponse[]>(
        owner!.session,
        `/api/trips/${encodeURIComponent(tripId)}/collections`,
        m.sharing_collections_load_error,
        { signal },
      ),
  });
  const download = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Session unavailable");
      const blob = await ownerFile(
        owner.session,
        `/api/trips/${encodeURIComponent(tripId)}/export/pdf`,
        m.pdf_failed,
        {
          method: "POST",
          cache: "no-store",
          body: {
            content,
            view,
            locale,
            audience: view === "audience" ? audience : null,
            confirm_private: view === "private" && confirmed,
          },
        },
      );
      saveFile(blob, `trip-${tripId}.pdf`);
    },
  });
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="grid gap-3">
      <Collapsible.Trigger render={<Button type="button" />}>{m.pdf_export()}</Collapsible.Trigger>
      <Collapsible.Panel className="grid min-w-0 gap-3">
        <ChoiceGroup
          label={m.pdf_content()}
          value={content}
          onChange={setContent}
          choices={[
            { value: "story", label: m.pdf_story() },
            { value: "itinerary", label: m.pdf_itinerary() },
            { value: "both", label: m.pdf_both() },
          ]}
        />
        <ChoiceGroup
          label={m.pdf_view()}
          value={view}
          onChange={(next) => {
            setView(next);
            setConfirmed(false);
          }}
          choices={[
            { value: "audience", label: m.pdf_audience() },
            { value: "private", label: m.pdf_private() },
          ]}
        />
        {view === "audience" && (
          <>
            <ChoiceGroup
              label={m.pdf_choose_audience()}
              value={audience}
              onChange={setAudience}
              choices={[
                ...(surface.data ? [{ value: "public", label: m.pdf_public() }] : []),
                ...(links.data ?? []).map((link) => ({
                  value: link.id,
                  label: m.pdf_link_audience({ name: link.label }),
                })),
                ...(memberships.data ?? []).map((member) => ({
                  value: `collection:${member.member_id}`,
                  label: m.pdf_collection_audience({ name: member.label }),
                })),
              ]}
            />
            <p className="text-sm">{m.pdf_audience_help()}</p>
            {(links.isError || surface.isError || memberships.isError) && (
              <Alert variant="error">{m.pdf_failed()}</Alert>
            )}
          </>
        )}
        {view === "private" && (
          <>
            <Alert>{m.pdf_private_warning()}</Alert>
            <Field>
              <FieldLabel className="flex items-center gap-2">
                <TravelCheckbox checked={confirmed} onCheckedChange={setConfirmed} />
                <span>{m.pdf_confirm_private()}</span>
              </FieldLabel>
            </Field>
          </>
        )}
        <p className="text-sm">{m.pdf_limits()}</p>
        <Button
          focusableWhenDisabled
          type="button"
          disabled={
            download.isPending || !content || !view || (view === "private" ? !confirmed : !audience)
          }
          onClick={() => download.mutate()}
        >
          {download.isPending ? m.pdf_generating() : m.pdf_download()}
        </Button>
        {download.isError && (
          <Alert variant="error" role="alert">
            {m.pdf_failed()}
          </Alert>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
