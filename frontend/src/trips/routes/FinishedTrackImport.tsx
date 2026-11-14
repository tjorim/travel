import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { useAuth } from "../../auth-context";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { GeoJsonLineString } from "../../api-types";
import { ownerRequest } from "../../query/api";
import { RouteGeometryEditor, type RouteCoordinate } from "../RouteGeometryEditor";

/** Files never enter query/mutation caches, form values or browser storage. */
export function FinishedTrackImport({
  tripId,
  onChange,
}: {
  tripId: string;
  onChange: (points: RouteCoordinate[]) => void;
}) {
  useLocale();
  const { session } = useAuth();
  const previewButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("100");
  const [draft, setDraft] = useState<RouteCoordinate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
  function reset() {
    controller.current?.abort();
    setBusy(false);
    setDraft(null);
    setFailed(false);
  }
  async function preview() {
    reset();
    const file = fileInput.current?.files?.[0];
    if (
      !file ||
      !session ||
      file.size > 2 * 1024 * 1024 ||
      !Number.isInteger(+start) ||
      !Number.isInteger(+end) ||
      +start < 0 ||
      +end > 100 ||
      +start >= +end
    ) {
      setFailed(true);
      return;
    }
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    try {
      const result = await ownerRequest<GeoJsonLineString>(
        session,
        `/api/trips/${tripId}/route-line-import?start=${+start}&end=${+end}`,
        m.routes_track_error,
        {
          method: "POST",
          body: file,
          signal: active.signal,
          headers: { "Content-Type": "application/octet-stream" },
          cache: "no-store",
        },
      );
      if (!active.signal.aborted) setDraft(result.coordinates);
    } catch {
      if (!active.signal.aborted) setFailed(true);
    } finally {
      if (!active.signal.aborted) {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  }
  return (
    <FieldSet className="grid gap-2.5">
      <FieldLegend>{m.routes_track_title()}</FieldLegend>
      <p className="help">{m.routes_track_privacy()}</p>
      <Field>
        <FieldLabel>{m.routes_track_file()}</FieldLabel>
        <Input ref={fileInput} type="file" accept=".gpx,.json,.geojson" onChange={reset} />
      </Field>
      <div className="field-row">
        <Field>
          <FieldLabel>{m.routes_track_start()}</FieldLabel>
          <Input
            type="number"
            min={0}
            max={99}
            step={1}
            value={start}
            onChange={(e) => {
              reset();
              setStart(e.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>{m.routes_track_end()}</FieldLabel>
          <Input
            type="number"
            min={1}
            max={100}
            step={1}
            value={end}
            onChange={(e) => {
              reset();
              setEnd(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="button-row">
        <Button type="button" ref={previewButton} disabled={busy} onClick={() => void preview()}>
          {m.routes_track_preview()}
        </Button>
        <Button
          type="button"
          className="secondary"
          onClick={() => {
            reset();
            if (fileInput.current) fileInput.current.value = "";
          }}
        >
          {m.routes_track_cancel()}
        </Button>
      </div>
      {(busy || failed) && (
        <p role="status">
          {busy ? m.routes_track_loading() : failed ? m.routes_track_error() : ""}
        </p>
      )}
      {draft && (
        <>
          <RouteGeometryEditor
            coordinates={draft}
            onChange={setDraft}
            heading={m.routes_track_draft_heading()}
            mapLabel={m.routes_track_draft_map()}
          />
          <Button
            type="button"
            disabled={draft.length < 2}
            onClick={() => {
              onChange(draft);
              reset();
              previewButton.current?.focus();
            }}
          >
            {m.routes_track_apply()}
          </Button>
        </>
      )}
    </FieldSet>
  );
}
