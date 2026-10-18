import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { useOwner } from "../../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../../RecordDialog";
import { ChoiceGroup } from "../../ui/ChoiceGroup";
import { Field, FieldLabel, FieldLegend, FieldSet } from "../../ui/field";
import { TravelCheckbox } from "../../ui/TravelCheckbox";
import type {
  PackingList,
  PackingRequest,
  PackingSave,
  PackingSource,
  PackingTemplate,
} from "./model";

/** Starts a new list for this trip from another trip's list or from saved templates. */
export function ReuseDialog({
  open,
  tripId,
  base,
  queryKey,
  name,
  onName,
  busy,
  save,
  request,
  onCreated,
  onClose,
}: {
  open: boolean;
  tripId: string;
  base: string;
  queryKey: unknown[];
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  save: PackingSave;
  request: PackingRequest;
  onCreated: (list: PackingList) => void;
  onClose: () => void;
}) {
  useLocale();
  const owner = useOwner();
  const client = useQueryClient();
  const [reuseMode, setReuseMode] = useState<"copy" | "templates">("copy");
  const [sourceId, setSourceId] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: [...queryKey, "sources"],
    enabled: !!owner && open,
    queryFn: () =>
      ownerRequest<PackingSource[]>(
        owner!.session,
        "/api/packing-list-sources",
        m.assets_loading_source_lists_failed,
      ),
  });
  const templatesQuery = useQuery({
    queryKey: [...queryKey, "templates"],
    enabled: !!owner && open,
    queryFn: () =>
      ownerRequest<PackingTemplate[]>(
        owner!.session,
        "/api/packing-templates",
        m.assets_loading_templates_failed,
      ),
  });
  return (
    <RecordDialog open={open} title={m.assets_reuse_packing_list()} onDismiss={() => onClose()}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (reuseMode === "copy" ? !sourceId : !templateIds.length) return;
          void save(
            async () => {
              const created = await request<PackingList>(base, "POST", {
                name: name.trim(),
                ...(reuseMode === "copy"
                  ? { copy_from_list_id: sourceId }
                  : { template_ids: templateIds }),
              });
              onCreated(created);
            },
            () => m.assets_packing_list_reused_all_items_are_unpacked(),
          ).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <ChoiceGroup
          label={m.assets_source()}
          value={reuseMode}
          choices={[
            { value: "copy", label: m.assets_another_packing_list() },
            { value: "templates", label: m.assets_templates() },
          ]}
          onChange={setReuseMode}
        />
        {reuseMode === "copy" ? (
          <Field>
            <FieldLabel className="block">{m.assets_packing_list()}</FieldLabel>
            <SearchSelect
              ariaLabel={m.assets_source_packing_list()}
              value={sourceId}
              onChange={setSourceId}
            >
              <option value="">{m.assets_choose_a_packing_list()}</option>
              {sourcesQuery.data
                ?.filter((source) => source.trip_id !== tripId)
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.trip_title} · {source.name}
                  </option>
                ))}
            </SearchSelect>
          </Field>
        ) : (
          <FieldSet className="space-y-2">
            <FieldLegend>{m.assets_choose_templates()}</FieldLegend>
            {templatesQuery.data?.map((template) => (
              <div key={template.id} className="flex items-center justify-between gap-2">
                <Field className="contents">
                  <FieldLabel className="flex min-h-11 items-center gap-2">
                    <TravelCheckbox
                      checked={templateIds.includes(template.id)}
                      onCheckedChange={(checked) =>
                        setTemplateIds((current) =>
                          checked
                            ? [...current, template.id]
                            : current.filter((id) => id !== template.id),
                        )
                      }
                    />{" "}
                    {template.name}
                  </FieldLabel>
                </Field>
                <Button
                  type="button"
                  className="secondary compact"
                  aria-label={m.assets_delete({ p0: template.name })}
                  onClick={() => setTemplateToDelete(template.id)}
                >
                  {m.owner_delete()}
                </Button>
              </div>
            ))}
          </FieldSet>
        )}
        {(sourcesQuery.isError || templatesQuery.isError) && (
          <p role="alert">{m.assets_loading_sources_failed_close_and_reopen_to_try_again()}</p>
        )}
        <Field className="contents">
          <FieldLabel className="block">
            {m.assets_new_packing_list_name()}
            <Input
              required
              maxLength={160}
              value={name}
              onChange={(event) => onName(event.target.value)}
            />
          </FieldLabel>
        </Field>
        <p className="text-sm">
          {m.assets_bags_order_categories_quantities_notes_and_assignments_are_preserved_all()}
        </p>
        <Button
          type="submit"
          disabled={
            busy || !name.trim() || (reuseMode === "copy" ? !sourceId : !templateIds.length)
          }
        >
          {m.assets_create_new_packing_list()}
        </Button>
      </form>
      {templateToDelete && (
        <DeleteConfirmation
          title={m.assets_delete_template()}
          onCancel={() => setTemplateToDelete(null)}
          onConfirm={() => {
            void save(
              () =>
                request(`/api/packing-templates/${encodeURIComponent(templateToDelete)}`, "DELETE"),
              () => m.assets_template_deleted(),
            ).then((ok) => {
              if (ok) {
                setTemplateIds((current) => current.filter((id) => id !== templateToDelete));
                setTemplateToDelete(null);
                void client.invalidateQueries({ queryKey: [...queryKey, "templates"] });
              }
            });
          }}
        />
      )}
    </RecordDialog>
  );
}
