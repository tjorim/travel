import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatNumber, useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { ownerFile, ownerRequest } from "../query/api";
import { ownerKeys } from "../query/keys";
import { useOwner, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { Field, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Alert } from "@/ui/alert";
import { CurrentLocations, type CurrentLocation } from "../CurrentLocations";
import { saveFile } from "./save-file";

type Precision = "off" | "exact" | "1km" | "10km";
type Point = { id: string; latitude: number; longitude: number; observed_at: string };
type Session = {
  id: string;
  source: string;
  enabled: boolean;
  audiences: Record<string, Exclude<Precision, "off">>;
  delays?: Record<string, number>;
  previews?: Record<string, CurrentLocation[]>;
  current: Point | null;
  stale: boolean;
};

export function LiveLocation({ tripId }: { tripId: string }) {
  useLocale();
  const owner = useOwner();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);
  const [draft, setDraft] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; session: boolean } | null>(null);
  const [inspecting, setInspecting] = useState("");
  const [after, setAfter] = useState("");
  const root = `/api/trips/${encodeURIComponent(tripId)}/live-location`;
  const key = [...ownerKeys.trip(owner?.subject ?? "", tripId), "live-location"];
  const request = <T,>(path: string, options = {}) =>
    ownerRequest<T>(owner!.session, root + path, m.live_failed, { cache: "no-store", ...options });
  const sessions = useQuery({
    queryKey: key,
    enabled: open && !!owner,
    queryFn: ({ signal }) => request<Session[]>("", { signal }),
    refetchInterval: open ? 30000 : false,
  });
  const links = useTripResource(open ? tripId : null, "share-links");
  const points = useQuery({
    queryKey: [...key, "tracks", inspecting, after],
    enabled: !!inspecting && !!owner,
    queryFn: ({ signal }) =>
      request<{ points: Point[]; next: string | null }>(
        `/${inspecting}/tracks?after=${encodeURIComponent(after)}`,
        { signal },
      ),
  });
  const change = useMutation({
    mutationFn: async (action: {
      kind: "create" | "configure" | "toggle" | "delete";
      path: string;
      method: "POST" | "PUT" | "DELETE";
      body?: unknown;
    }) => request(action.path, { method: action.method, body: action.body }),
    onSuccess: (_, action) => {
      if (action.kind === "create") {
        setCreating(false);
        setSource("");
      } else if (action.kind === "configure") {
        setEditing(null);
        setDraft(null);
      } else if (action.kind === "delete") {
        setDeleting(null);
      }
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const download = useMutation({
    mutationFn: async (id: string) => {
      const blob = await ownerFile(owner!.session, `${root}/${id}/export`, m.live_failed, {
        cache: "no-store",
      });
      saveFile(blob, "private-tracks.jsonl");
    },
  });
  const choices = [
    { value: "off" as const, label: m.live_off() },
    { value: "10km" as const, label: m.live_10km() },
    { value: "1km" as const, label: m.live_1km() },
    { value: "exact" as const, label: m.live_exact() },
  ];
  const editPrecision = (audience: string, precision: Precision) => {
    if (!draft) return;
    const audiences = { ...draft.audiences };
    if (precision === "off") delete audiences[audience];
    else audiences[audience] = precision;
    setDraft({ ...draft, audiences });
  };
  const audienceControls = (audience: string, label: string) => (
    <div key={audience} className="grid gap-2">
      <ChoiceGroup
        label={label}
        value={draft?.audiences[audience] ?? "off"}
        choices={choices}
        onChange={(value) => editPrecision(audience, value)}
      />
      {draft?.audiences[audience] && (
        <ChoiceGroup
          label={m.live_delay_label({ audience: label })}
          value={String(draft.delays?.[audience] ?? 0)}
          choices={[0, 900, 1800, 3600, 7200, 86400].map((seconds) => ({
            value: String(seconds),
            label: m.live_delay_value({ minutes: formatNumber(seconds / 60) }),
          }))}
          onChange={(value) =>
            setDraft({ ...draft, delays: { ...draft.delays, [audience]: Number(value) } })
          }
        />
      )}
    </div>
  );
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="grid gap-3">
      <Collapsible.Trigger render={<Button type="button" />}>{m.live_title()}</Collapsible.Trigger>
      <Collapsible.Panel className="grid min-w-0 gap-3">
        <p>{m.live_privacy()}</p>
        <p>{m.live_freshness()}</p>
        <Button
          type="button"
          onClick={() => {
            change.reset();
            setCreating(true);
          }}
        >
          {m.live_add()}
        </Button>
        {(sessions.isError || change.isError || download.isError || points.isError) && (
          <Alert variant="error" role="alert">
            {m.live_failed()}
          </Alert>
        )}
        {sessions.isPending && <p>{m.live_loading()}</p>}
        {sessions.data?.map((row) => (
          <section key={row.id} className="grid min-w-0 gap-2 rounded-xl border p-3">
            <h3 className="break-all">{row.source}</h3>
            <p>{row.enabled ? m.live_enabled() : m.live_off()}</p>
            {row.current && (
              <p>
                {formatNumber(row.current.latitude, { maximumFractionDigits: 8 })},{" "}
                {formatNumber(row.current.longitude, { maximumFractionDigits: 8 })} ·{" "}
                {formatDate(new Date(row.current.observed_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {row.stale ? m.live_stale() : m.live_current()}
              </p>
            )}
            {Object.entries(row.audiences).map(([audience, precision]) => (
              <div key={audience} className="grid gap-2">
                <p>
                  {audience === "public"
                    ? m.live_public()
                    : (links.data?.find((link) => link.id === audience)?.label ??
                      m.live_hidden())}{" "}
                  · {choices.find((choice) => choice.value === precision)?.label} ·{" "}
                  {m.live_delay_value({
                    minutes: formatNumber((row.delays?.[audience] ?? 0) / 60),
                  })}
                </p>
                {row.previews?.[audience]?.length ? (
                  <CurrentLocations positions={row.previews[audience]} />
                ) : (
                  <p>{m.live_waiting()}</p>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={change.isPending}
                onClick={() => {
                  change.reset();
                  setEditing(row);
                  setDraft(structuredClone(row));
                }}
              >
                {m.live_configure()}
              </Button>
              <Button
                type="button"
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({
                    kind: "toggle",
                    path: `/${row.id}`,
                    method: "PUT",
                    body: { enabled: !row.enabled, audiences: row.audiences },
                  })
                }
              >
                {row.enabled ? m.live_stop() : m.live_start()}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setInspecting(row.id);
                  setAfter("");
                }}
              >
                {m.live_inspect()}
              </Button>
              <Button
                type="button"
                disabled={download.isPending}
                onClick={() => download.mutate(row.id)}
              >
                {m.live_export()}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  change.reset();
                  setDeleting({ id: row.id, session: false });
                }}
              >
                {m.live_delete_tracks()}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  change.reset();
                  setDeleting({ id: row.id, session: true });
                }}
              >
                {m.live_revoke()}
              </Button>
            </div>
          </section>
        ))}
        <RecordDialog
          open={creating}
          title={m.live_add()}
          dirty={!!source || change.isPending}
          onDismiss={() => {
            setCreating(false);
            setSource("");
          }}
          error={change.isError ? m.live_failed() : null}
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate({ kind: "create", path: "", method: "POST", body: { source } });
            }}
          >
            <Field>
              <FieldLabel>{m.live_source()}</FieldLabel>
              <Input
                required
                pattern="(person|device_tracker)\.[a-z0-9_]+"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={change.isPending}>
              {m.live_add()}
            </Button>
          </form>
        </RecordDialog>
        <RecordDialog
          open={!!editing}
          title={m.live_configure()}
          dirty={JSON.stringify(draft) !== JSON.stringify(editing) || change.isPending}
          onDismiss={() => {
            setEditing(null);
            setDraft(null);
          }}
          error={change.isError ? m.live_failed() : null}
        >
          {draft && (
            <div className="grid gap-3">
              <p>{m.live_audience_warning()}</p>
              {audienceControls("public", m.live_public())}
              {links.data?.map((link) => audienceControls(link.id, link.label))}
              <Button
                type="button"
                disabled={change.isPending || links.isPending || links.isError}
                onClick={() =>
                  change.mutate({
                    kind: "configure",
                    path: `/${draft.id}`,
                    method: "PUT",
                    body: {
                      enabled: draft.enabled,
                      audiences: draft.audiences,
                      delays: Object.fromEntries(
                        Object.keys(draft.audiences).map((audience) => [
                          audience,
                          draft.delays?.[audience] ?? 0,
                        ]),
                      ),
                    },
                  })
                }
              >
                {m.live_save()}
              </Button>
            </div>
          )}
        </RecordDialog>
        <RecordDialog
          open={!!inspecting}
          title={m.live_inspect()}
          onDismiss={() => setInspecting("")}
        >
          <div className="grid gap-2">
            {points.data?.points.map((point) => (
              <p key={point.id}>
                {formatDate(new Date(point.observed_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {formatNumber(point.latitude, { maximumFractionDigits: 8 })},{" "}
                {formatNumber(point.longitude, { maximumFractionDigits: 8 })}
              </p>
            ))}
            <Button
              type="button"
              disabled={!points.data?.next}
              onClick={() => setAfter(points.data?.next ?? "")}
            >
              {m.live_next()}
            </Button>
          </div>
        </RecordDialog>
        {deleting && (
          <DeleteConfirmation
            title={deleting.session ? m.live_revoke() : m.live_delete_tracks()}
            description={change.isError ? m.live_failed() : m.live_delete_warning()}
            confirmDisabled={change.isPending}
            onCancel={() => setDeleting(null)}
            onConfirm={() =>
              change.mutate({
                kind: "delete",
                path: `/${deleting.id}${deleting.session ? "" : "/tracks"}`,
                method: "DELETE",
              })
            }
          />
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
