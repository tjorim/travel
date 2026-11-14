import { Button } from "@/ui/button";
import { useState } from "react";

import { AsyncSearchSelect, SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ErrorFallback } from "../../query/api";
import { errorNotice, textNotice, type Notice } from "../../query/feedback";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation, useTravelUpdateSearch } from "../../query/owner-queries";
import { formatCapture } from "../../dates";
import { visitTitle, areaName } from "../../records";
import {
  type AreaSuggestion,
  type MediaAsset,
  type TravelUpdate,
  type TravelUpdateCandidate,
  type TravelUpdateCandidatesResponse,
  type Visit,
} from "../../api-types";
import { type TravelUpdateCandidateIntent } from "../../capture-draft";
import { Field, FieldLabel } from "@/ui/field";

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
    fallback: m.media_the_possible_travel_updates_could_not_be_calculated,
    request: (mediaAssetIds) => ({
      path: `${mediaPath}/travel-update-candidates`,
      method: "POST",
      body: { media_asset_ids: mediaAssetIds },
    }),
    // A review is computed for this screen only; nothing is stored.
    invalidate: () => [],
  });
  const suggestArea = useOwnerMutation<{ latitude: number; longitude: number }, AreaSuggestion>({
    fallback: m.common_an_area_could_not_be_suggested,
    request: (body) => ({ path: tripPath(tripId, "areas/suggest"), method: "POST", body }),
    invalidate: () => [],
    gcTime: 0,
  });
  const attach = useOwnerMutation<{ updateId: string; mediaAssetIds: string[] }>({
    fallback: m.media_link_to_update_error,
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
      onNotice(textNotice(() => m.media_review_choose_first_hint()));
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
            ? m.media_review_candidates_notice()
            : m.media_this_selection_has_no_usable_capture_or_location_data(),
        ),
      );
    }, fail(m.media_the_possible_travel_updates_could_not_be_calculated));
  }

  function candidateAssetNames(candidate: TravelUpdateCandidate) {
    return candidate.media_asset_ids
      .map(
        (id) =>
          assets.find((asset) => asset.id === id)?.original_filename ??
          m.media_unnamed_media_item(),
      )
      .join(", ");
  }

  function suggestCandidateArea(candidate: TravelUpdateCandidate) {
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      onNotice(textNotice(() => m.media_choose_a_gps_option_first()));
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
        fail(m.common_an_area_could_not_be_suggested),
      );
  }

  function startCandidateUpdate(candidate: TravelUpdateCandidate) {
    const time =
      candidateTimes[candidate.id] ||
      (candidate.time_options.length === 1 ? candidate.time_options[0].captured_at : "");
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.time_options.length > 1 && !time) {
      onNotice(textNotice(() => m.media_candidate_time_required_hint()));
      return;
    }
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      onNotice(textNotice(() => m.media_candidate_gps_differs_hint()));
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
      onNotice(textNotice(() => m.media_candidate_update_required_hint()));
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
          m.media_linked_to_update_notice({
            title: update.title,
          }),
        ),
      );
    }, fail(m.media_link_to_update_error));
  }

  if (assets.length === 0) return null;
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.media_review_possible_travel_updates()}</h3>
          <p>
            {m.media_review_intro({
              metres: candidateReview?.gps_agreement_metres ?? 500,
            })}
          </p>
        </div>
      </div>
      <Button className="w-fit" type="button" onClick={review}>
        {m.media_review_selected_media()}
      </Button>
      {candidateReview?.unavailable_media_asset_ids.length ? (
        <p className="help">
          {m.media_metadata_unavailable({
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
              : m.media_no_capture_time_available()}
          </span>
          {candidate.time_options.length > 1 && (
            <Field>
              <FieldLabel>{m.media_use_capture_time()}</FieldLabel>
              <SearchSelect
                ariaLabel={m.media_use_capture_time()}
                value={candidateTimes[candidate.id] ?? ""}
                onChange={(value) =>
                  setCandidateTimes((current) => ({ ...current, [candidate.id]: value }))
                }
              >
                <option value="">{m.media_choose_a_time_yourself()}</option>
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
              <FieldLabel>{m.media_gps_choice()}</FieldLabel>
              <SearchSelect
                ariaLabel={m.media_gps_choice()}
                value={candidateLocations[candidate.id] ?? ""}
                onChange={(value) =>
                  setCandidateLocations((current) => ({ ...current, [candidate.id]: value }))
                }
              >
                <option value="">{m.media_dismiss_location()}</option>
                {candidate.location_options.map((option, index) => (
                  <option key={option.media_asset_ids.join("-")} value={index}>
                    {m.media_candidate_location_source_count({
                      count: option.media_asset_ids.length,
                    })}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          )}
          {candidate.location_options.length === 0 && (
            <p className="help">{m.media_no_gps_available_no_place_will_be_suggested()}</p>
          )}
          {candidate.location_options.length > 1 && (
            <p className="help">{m.media_candidate_gps_conflict_hint()}</p>
          )}
          {candidate.location_options.length > 0 && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => suggestCandidateArea(candidate)}
            >
              {m.media_suggest_area_and_visit()}
            </Button>
          )}
          {candidateAreas[candidate.id] && (
            <p className="help">
              {m.media_candidate_unsaved_summary({
                area: candidateAreas[candidate.id].existing_area_id
                  ? m.media_existing_area({ area: areaName(candidateAreas[candidate.id].area) })
                  : m.media_new_area_possible({
                      area: areaName(candidateAreas[candidate.id].area),
                      timezone:
                        candidateAreas[candidate.id].area.timezone ?? m.media_unknown_timezone(),
                    }),
                time:
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
                    .join(", ") || m.media_new_visit_possible(),
              })}
            </p>
          )}
          <div className="button-row">
            <Button type="button" onClick={() => startCandidateUpdate(candidate)}>
              {m.media_open_as_a_new_travel_update()}
            </Button>
            {
              <>
                <Field>
                  <FieldLabel className="scope-choice">{m.media_link_to()}</FieldLabel>
                  <AsyncSearchSelect
                    ariaLabel={m.media_link_to()}
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
                        { value: "", label: m.media_choose_existing_travel_update() },
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
                  {m.media_link_to_travel_update()}
                </Button>
              </>
            }
          </div>
        </article>
      ))}
    </div>
  );
}
