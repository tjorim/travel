import { SelectField, TextField } from "../../forms/fields";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { MediaAsset } from "../../api-types";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { dimensionInRange, type DerivativeValues } from "./copy-form";

/** The fields for a new shareable copy: its purpose, and a size for a photo or audio handling for a video. */
export function CopyCreateFields({
  record,
  mediaKind,
}: {
  record: ReturnType<typeof useRecordForm<DerivativeValues>>;
  mediaKind: MediaAsset["media_kind"];
}) {
  useLocale();
  return (
    <div className="field-row">
      <record.form.Field name="purpose">
        {(field) => (
          <SelectField field={field} label={m.media_purpose()}>
            <option value="share">{m.common_sharing()}</option>
            <option value="owner_preview">{m.media_private_preview()}</option>
          </SelectField>
        )}
      </record.form.Field>
      {mediaKind === "photo" && (
        <record.form.Field
          name="maxDimension"
          validators={{ onChange: dimensionInRange, onSubmit: dimensionInRange }}
        >
          {(field) => (
            <TextField
              field={field}
              label={m.media_maximum_side_px()}
              required
              min={64}
              max={4000}
              type="number"
            />
          )}
        </record.form.Field>
      )}
      {mediaKind === "video" && (
        <record.form.Field name="removeAudio">
          {(field) => (
            <Field className="contents">
              <FieldLabel className="scope-choice">
                <TravelCheckbox
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                {m.media_remove_audio()}
              </FieldLabel>
            </Field>
          )}
        </record.form.Field>
      )}
    </div>
  );
}
