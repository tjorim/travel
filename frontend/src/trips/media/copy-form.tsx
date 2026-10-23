import { useState } from "react";

import type { TrackerSession } from "../../auth";
import { MarkdownField } from "../../forms/MarkdownField";
import { AsyncSearchSelect, TextField } from "../../forms/fields";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useTravelUpdateSearch } from "../../query/owner-queries";
import type { MediaDerivative, TravelUpdate } from "../../tracker-model";
import { Field, FieldLabel } from "@/ui/field";
import { OwnerImage } from "../OwnerImage";

export type DerivativeValues = {
  purpose: MediaDerivative["purpose"];
  maxDimension: string;
  removeAudio: boolean;
};
export const blankDerivative = (): DerivativeValues => ({
  purpose: "share",
  maxDimension: "1600",
  removeAudio: false,
});
export const dimensionInRange = ({ value }: { value: string }) => {
  const size = Number(value);
  return value.trim() && Number.isInteger(size) && size >= 64 && size <= 4000
    ? undefined
    : m.assets_choose_a_maximum_side_between_64_and_4000_px;
};

export type PresentationValues = {
  travelUpdateId: string;
  caption: string;
  altText: string;
  focalX: string;
  focalY: string;
};
export const blankPresentation = (): PresentationValues => ({
  travelUpdateId: "",
  caption: "",
  altText: "",
  focalX: "",
  focalY: "",
});
export const fromDerivative = (derivative: MediaDerivative): PresentationValues => ({
  travelUpdateId: derivative.travel_update_id ?? "",
  caption: derivative.caption ?? "",
  altText: derivative.alt_text ?? "",
  focalX: derivative.focal_x?.toString() ?? "",
  focalY: derivative.focal_y?.toString() ?? "",
});
const percentage = ({ value }: { value: string }) =>
  value === "" || (Number(value) >= 0 && Number(value) <= 100)
    ? undefined
    : m.assets_choose_a_value_between_0_and_100;

/** The copy's presentation fields, with a live focal-point preview when the copy can be shown inline. */
export function PresentationFields({
  record,
  tripId,
  updates,
  previewUrl,
  session,
}: {
  record: ReturnType<typeof useRecordForm<PresentationValues>>;
  tripId: string;
  updates: TravelUpdate[];
  previewUrl: string | null;
  session: TrackerSession | null;
}) {
  useLocale();
  const focalX = record.values.focalX === "" ? 50 : Number(record.values.focalX);
  const focalY = record.values.focalY === "" ? 50 : Number(record.values.focalY);
  const searchUpdates = useTravelUpdateSearch(tripId);
  const [foundTitles, setFoundTitles] = useState<Record<string, string>>({});
  return (
    <>
      {previewUrl && session && (
        <div className="relative mb-2.5 inline-block max-w-55">
          <OwnerImage
            session={session}
            url={previewUrl}
            alt={m.assets_preview_of_the_copy()}
            className="block max-h-55 w-full rounded-travel-media bg-travel-media-bg object-contain"
          />
          <span
            data-focal-point-marker=""
            className="pointer-events-none absolute -mt-2.25 -ml-2.25 size-4.5 rounded-full border-2 border-travel-surface bg-travel-focal-marker shadow-md"
            style={{ left: `${focalX}%`, top: `${focalY}%` }}
            aria-hidden="true"
          />
        </div>
      )}
      <record.form.Field name="travelUpdateId">
        {(field) => (
          <Field>
            <FieldLabel>{m.assets_with_travel_update()}</FieldLabel>
            <AsyncSearchSelect
              ariaLabel={m.assets_with_travel_update()}
              value={field.state.value}
              selectedOption={
                field.state.value
                  ? {
                      value: field.state.value,
                      label:
                        foundTitles[field.state.value] ??
                        updates.find((update) => update.id === field.state.value)?.title ??
                        field.state.value,
                    }
                  : null
              }
              defaultOptions={[
                { value: "", label: m.assets_standalone_gallery_photo() },
                ...updates
                  .slice(0, 50)
                  .map((update) => ({ value: update.id, label: update.title })),
              ]}
              onChange={field.handleChange}
              loadOptions={async (q) => {
                const matches = await searchUpdates(q);
                setFoundTitles((current) => ({
                  ...current,
                  ...Object.fromEntries(matches.map((update) => [update.id, update.title])),
                }));
                return [
                  { value: "", label: m.assets_standalone_gallery_photo() },
                  ...matches.map((update) => ({ value: update.id, label: update.title })),
                ];
              }}
            />
          </Field>
        )}
      </record.form.Field>
      <record.form.Field name="caption">
        {(field) => (
          <MarkdownField
            field={field}
            format="inline"
            label={m.assets_caption()}
            maxLength={500}
            rows={2}
          />
        )}
      </record.form.Field>
      <record.form.Field name="altText">
        {(field) => <TextField field={field} label={m.assets_alternative_text()} maxLength={300} />}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field
          name="focalX"
          validators={{ onChange: percentage, onSubmit: percentage }}
        >
          {(field) => (
            <TextField
              field={field}
              label={m.assets_horizontal_focus()}
              type="number"
              min="0"
              max="100"
            />
          )}
        </record.form.Field>
        <record.form.Field
          name="focalY"
          validators={{ onChange: percentage, onSubmit: percentage }}
        >
          {(field) => (
            <TextField
              field={field}
              label={m.assets_vertical_focus()}
              type="number"
              min="0"
              max="100"
            />
          )}
        </record.form.Field>
      </div>
    </>
  );
}
