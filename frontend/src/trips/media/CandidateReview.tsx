import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { AsyncSearchSelect, SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ErrorFallback } from "../../query/api";
import { errorNotice, textNotice, type Notice } from "../../query/feedback";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation, useTravelUpdateSearch } from "../../query/owner-queries";
import {
  formatCapture,
  visitTitle,
  type AreaSuggestion,
  type MediaAsset,
  type TravelUpdate,
  type TravelUpdateCandidate,
  type TravelUpdateCandidateIntent,
  type TravelUpdateCandidatesResponse,
  type Visit,
} from "../../tracker-model";
import { Field, FieldLabel } from "../../ui/field";

/**
 * Reviews the selected media for possible travel updates: nothing is stored, and a candidate only opens the capture
 * dialog or links the media to an existing travel update when the owner asks.
 */
export function CandidateReview({
  tripId,
  assets,
  visits,
  reviewSelection,
  onNotice,
  onStartCaptureFromCandidate,
}: {
  tripId: string;
  assets: MediaAsset[];
  visits: Visit[];
  reviewSelection: string[];
  onNotice: (notice: Notice) => void;
  onStartCaptureFromCandidate: (candidate: TravelUpdateCandidateIntent) => void;
}) {
  useLocale();
  const searchUpdates = useTravelUpdateSearch(tripId);
  const mediaPath = tripPath(tripId, "media");
  const [candidateReview, setCandidateReview] = useState<TravelUpdateCandidatesResponse | null>(
    null,
  );
  const [candidateTimes, setCandidateTimes] = useState<Record<string, string>>({});
  const [candidateLocations, setCandidateLocations] = useState<Record<string, string>>({});
  const [candidateAttachments, setCandidateAttachments] = useState<Record<string, string>>({});
  const [foundUpdates, setFoundUpdates] = useState<Record<string, TravelUpdate>>({});
  const [candidateAreas, setCandidateAreas] = useState<Record<string, AreaSuggestion>>({});

  const reviewCandidates = useOwnerMutation<string[], TravelUpdateCandidatesResponse>({
    fallback: m.assets_the_possible_travel_updates_could_not_be_calculated,
    request: (mediaAssetIds) => ({
      path: `${mediaPath}/travel-update-candidates`,
      method: "POST",
      body: { media_asset_ids: mediaAssetIds },
    }),
    // A review is computed for this screen only; nothing is stored.
    invalidate: () => [],
  });
  const suggestArea = useOwnerMutation<{ latitude: number; longitude: number }, AreaSuggestion>({
    fallback: m.owner_an_area_could_not_be_suggested,
    request: (body) => ({ path: tripPath(tripId, "areas/suggest"), method: "POST", body }),
    invalidate: () => [],
    gcTime: 0,
  });
  const attach = useOwnerMutation<{ updateId: string; mediaAssetIds: string[] }>({
    fallback: m.assets_the_private_media_could_not_be_linked_to_the_travel_update,
    request: ({ updateId, mediaAssetIds }) => ({
      path: tripPath(tripId, `travel-updates/${updateId}`),
      method: "PATCH",
      body: { media_asset_ids: mediaAssetIds },
    }),
    invalidate: (subject) => [
      ownerKeys.trips(subject),
      [...ownerKeys.trip(subject, tripId), "travel-updates"],
    ],
  });

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    onNotice(errorNotice(error, fallback));

  function review() {
    if (reviewSelection.length === 0) {
      onNotice(
        textNotice(() => m.assets_choose_private_media_first_to_review_possible_travel_updates()),
      );
      return;
    }
    reviewCandidates.mutateAsync(reviewSelection).then((result) => {
      setCandidateReview(result);
      setCandidateTimes({});
      setCandidateLocations({});
      setCandidateAttachments({});
      setCandidateAreas({});
      onNotice(
        textNotice(() =>
          result.candidates.length
            ? m.assets_candidates_were_calculated_for_this_private_review_only_nothing_has_been()
            : m.assets_this_selection_has_no_usable_capture_or_location_data(),
        ),
      );
    }, fail(m.assets_the_possible_travel_updates_could_not_be_calculated));
  }

  function candidateAssetNames(candidate: TravelUpdateCandidate) {
    return candidate.media_asset_ids
      .map(
        (id) =>
          assets.find((asset) => asset.id === id)?.original_filename ??
          m.assets_unnamed_media_item(),
      )
      .join(", ");
  }

  function suggestCandidateArea(candidate: TravelUpdateCandidate) {
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      onNotice(textNotice(() => m.assets_choose_a_gps_option_first()));
      return;
    }
    const location =
      candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    if (!location) return;
    suggestArea
      .mutateAsync({ latitude: location.latitude, longitude: location.longitude })
      .then(
        (suggestion) =>
          setCandidateAreas((current) => ({ ...current, [candidate.id]: suggestion })),
        fail(m.owner_an_area_could_not_be_suggested),
      );
  }

  function startCandidateUpdate(candidate: TravelUpdateCandidate) {
    const time =
      candidateTimes[candidate.id] ||
      (candidate.time_options.length === 1 ? candidate.time_options[0].captured_at : "");
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.time_options.length > 1 && !time) {
      onNotice(
        textNotice(() =>
          m.assets_choose_which_capture_time_to_use_for_this_candidate_visit_first(),
        ),
      );
      return;
    }
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      onNotice(
        textNotice(() =>
          m.assets_the_gps_metadata_differs_choose_a_location_option_yourself_first_or_igno(),
        ),
      );
      return;
    }
    const selectedLocation =
      locationIndex === ""
        ? undefined
        : candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    onStartCaptureFromCandidate({
      tripId: tripId,
      mediaAssetIds: candidate.media_asset_ids,
      occurredAt: time || undefined,
      occurredAtLocal: candidate.time_options.find((option) => option.captured_at === time)
        ?.captured_local,
      gps: selectedLocation && {
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
      },
    });
  }

  function attachCandidate(candidate: TravelUpdateCandidate) {
    const update = foundUpdates[candidateAttachments[candidate.id]];
    if (!update) {
      onNotice(
        textNotice(() =>
          m.assets_choose_an_existing_travel_update_to_link_the_private_media_to_first(),
        ),
      );
      return;
    }
    const mediaAssetIds = [...new Set([...update.media_asset_ids, ...candidate.media_asset_ids])];
    attach.mutateAsync({ updateId: update.id, mediaAssetIds }).then(() => {
      setFoundUpdates((current) => ({
        ...current,
        [update.id]: { ...update, media_asset_ids: mediaAssetIds },
      }));
      onNotice(
        textNotice(() =>
          m.assets_private_media_linked_to_no_location_or_shareable_content_was_created({
            p0: update.title,
          }),
        ),
      );
    }, fail(m.assets_the_private_media_could_not_be_linked_to_the_travel_update));
  }

  if (assets.length === 0) return null;
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.assets_review_possible_travel_updates()}</h3>
          <p>
            {m.assets_choose_private_media_above_candidates_use_a_twohour_window_and_ke_line({
              p0: candidateReview?.gps_agreement_metres ?? 500,
            })}
          </p>
        </div>
      </div>
      <Button className="w-fit" type="button" onClick={review}>
        {m.assets_review_selected_media()}
      </Button>
      {candidateReview?.unavailable_media_asset_ids.length ? (
        <p className="help">
          {m.assets_metadata_unavailable({
            count: candidateReview.unavailable_media_asset_ids.length,
          })}
        </p>
      ) : null}
      {candidateReview?.candidates.map((candidate) => (
        <article className="scope-item" key={candidate.id}>
          <strong>{candidateAssetNames(candidate)}</strong>
          <span>
            {candidate.starts_at
              ? `${formatCapture(candidate.starts_at, candidate.captured_local)}${candidate.ends_at && candidate.ends_at !== candidate.starts_at ? ` – ${formatCapture(candidate.ends_at, candidate.captured_local, "HH:mm")}` : ""}`
              : m.assets_no_capture_time_available()}
          </span>
          {candidate.time_options.length > 1 && (
            <Field>
              <FieldLabel>{m.assets_use_capture_time()}</FieldLabel>
              <SearchSelect
                ariaLabel={m.assets_use_capture_time()}
                value={candidateTimes[candidate.id] ?? ""}
                onChange={(value) =>
                  setCandidateTimes((current) => ({ ...current, [candidate.id]: value }))
                }
              >
                <option value="">{m.assets_choose_a_time_yourself()}</option>
                {candidate.time_options.map((option) => (
                  <option key={option.media_asset_id} value={option.captured_at}>
                    {formatCapture(option.captured_at, option.captured_local)}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          )}
          {candidate.location_options.length > 1 && (
            <Field>
              <FieldLabel>{m.assets_gps_choice()}</FieldLabel>
              <SearchSelect
                ariaLabel={m.assets_gps_choice()}
                value={candidateLocations[candidate.id] ?? ""}
                onChange={(value) =>
                  setCandidateLocations((current) => ({ ...current, [candidate.id]: value }))
                }
              >
                <option value="">{m.owner_dismiss_location()}</option>
                {candidate.location_options.map((option, index) => (
                  <option key={option.media_asset_ids.join("-")} value={index}>
                    {m.assets_location_from_media_items_line({
                      p0: option.media_asset_ids.length,
                    })}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          )}
          {candidate.location_options.length === 0 && (
            <p className="help">{m.assets_no_gps_available_no_place_will_be_suggested()}</p>
          )}
          {candidate.location_options.length > 1 && (
            <p className="help">
              {m.assets_the_gps_metadata_conflicts_choose_at_most_one_option_nothing_will_be_mer()}
            </p>
          )}
          {candidate.location_options.length > 0 && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => suggestCandidateArea(candidate)}
            >
              {m.assets_suggest_area_and_visit()}
            </Button>
          )}
          {candidateAreas[candidate.id] && (
            <p className="help">
              {m.assets_this_suggestion_has_not_been_saved_line({
                p0: candidateAreas[candidate.id].existing_area_id
                  ? m.assets_existing_area({ p0: candidateAreas[candidate.id].area.label })
                  : m.assets_new_area_possible({
                      p0: candidateAreas[candidate.id].area.label,
                      p1: candidateAreas[candidate.id].area.timezone ?? m.assets_unknown_timezone(),
                    }),
                p1:
                  visits
                    .filter(
                      (visit) =>
                        visit.area.id === candidateAreas[candidate.id].existing_area_id &&
                        candidate.starts_at &&
                        visit.starts_on &&
                        candidate.starts_at.slice(0, 10) >= visit.starts_on &&
                        candidate.starts_at.slice(0, 10) <= (visit.ends_on ?? visit.starts_on),
                    )
                    .map((visit) => visitTitle(visit))
                    .join(", ") || m.assets_new_visit_possible(),
              })}
            </p>
          )}
          <div className="button-row">
            <Button type="button" onClick={() => startCandidateUpdate(candidate)}>
              {m.assets_open_as_a_new_travel_update()}
            </Button>
            {
              <>
                <Field>
                  <FieldLabel className="scope-choice">{m.assets_link_to()}</FieldLabel>
                  <AsyncSearchSelect
                    ariaLabel={m.assets_link_to()}
                    value={candidateAttachments[candidate.id] ?? ""}
                    selectedOption={
                      foundUpdates[candidateAttachments[candidate.id]]
                        ? {
                            value: candidateAttachments[candidate.id],
                            label: foundUpdates[candidateAttachments[candidate.id]].title,
                          }
                        : null
                    }
                    onChange={(value) =>
                      setCandidateAttachments((current) => ({
                        ...current,
                        [candidate.id]: value,
                      }))
                    }
                    loadOptions={async (q) => {
                      const updates = await searchUpdates(q);
                      setFoundUpdates((current) => ({
                        ...current,
                        ...Object.fromEntries(updates.map((update) => [update.id, update])),
                      }));
                      return [
                        { value: "", label: m.assets_choose_existing_travel_update() },
                        ...updates.map((update) => ({ value: update.id, label: update.title })),
                      ];
                    }}
                  />
                </Field>
                <Button
                  className="secondary"
                  type="button"
                  onClick={() => attachCandidate(candidate)}
                >
                  {m.assets_link_to_travel_update()}
                </Button>
              </>
            }
          </div>
        </article>
      ))}
    </div>
  );
}
