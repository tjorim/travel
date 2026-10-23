import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type {
  ImportCompleteResult,
  ImportSession,
  MediaAsset,
  MediaDerivative,
} from "../../tracker-model";

/** The owner API calls behind the media library: uploads, deletes, copies and provider imports. */
export function useMediaMutations(tripId: string, selected: MediaAsset | null) {
  const mediaPath = tripPath(tripId, "media");
  const refreshMedia = (subject: string) => [ownerKeys.tripResource(subject, tripId, "media")];
  const refreshDerivatives = (subject: string, { assetId }: { assetId: string }) => [
    ownerKeys.derivatives(subject, tripId, "media", assetId),
  ];

  const upload = useOwnerMutation<FormData, MediaAsset>({
    fallback: m.assets_the_media_could_not_be_uploaded,
    request: (body) => ({ path: `${mediaPath}/uploads`, method: "POST", body }),
    invalidate: refreshMedia,
  });
  const remove = useOwnerMutation<MediaAsset>({
    fallback: m.assets_the_media_could_not_be_deleted,
    request: (asset) => ({ path: `${mediaPath}/${asset.id}`, method: "DELETE" }),
    // The server also drops the deleted asset from the reisupdates that used it.
    invalidate: (subject) => [...refreshMedia(subject), ownerKeys.trips(subject)],
  });
  const requestDerivative = useOwnerMutation<
    {
      assetId: string;
      purpose: MediaDerivative["purpose"];
      maxDimension: number;
      removeAudio: boolean;
    },
    MediaDerivative
  >({
    fallback: m.assets_the_copy_could_not_be_created,
    request: ({ assetId, purpose, maxDimension, removeAudio }) => ({
      path: `${mediaPath}/${assetId}/derivatives`,
      method: "POST",
      body: {
        purpose,
        max_dimension: maxDimension,
        ...(selected?.media_kind === "video" ? { remove_audio: removeAudio } : {}),
      },
    }),
    invalidate: refreshDerivatives,
  });
  const approve = useOwnerMutation<
    { assetId: string; derivative: MediaDerivative },
    MediaDerivative
  >({
    fallback: m.assets_the_copy_could_not_be_approved,
    request: ({ assetId, derivative }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/approve`,
      method: "POST",
    }),
    invalidate: refreshDerivatives,
  });
  const retry = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>(
    {
      fallback: m.assets_the_video_could_not_be_processed_again,
      request: ({ assetId, derivative }) => ({
        path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/retry`,
        method: "POST",
      }),
      invalidate: refreshDerivatives,
    },
  );
  const presentation = useOwnerMutation<
    { assetId: string; derivative: MediaDerivative; values: Record<string, unknown> },
    MediaDerivative
  >({
    fallback: m.assets_the_presentation_could_not_be_saved,
    request: ({ assetId, derivative, values }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/presentation`,
      method: "PATCH",
      body: values,
    }),
    invalidate: refreshDerivatives,
  });
  const setCover = useOwnerMutation<MediaDerivative | null>({
    fallback: m.assets_the_cover_could_not_be_saved,
    request: (derivative) => ({
      path: `/api/trips/${encodeURIComponent(tripId)}`,
      method: "PATCH",
      body: { cover_derivative_id: derivative?.id ?? null },
    }),
    // The previous cover may belong to another asset, and each audience's overview shows whether it receives the cover.
    invalidate: (subject) => [
      ownerKeys.trips(subject),
      ownerKeys.tripResource(subject, tripId, "media"),
      ownerKeys.tripResource(subject, tripId, "overview"),
    ],
  });
  const removeDerivative = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }>({
    fallback: m.assets_the_copy_could_not_be_deleted,
    request: ({ assetId, derivative }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}`,
      method: "DELETE",
    }),
    invalidate: refreshDerivatives,
  });
  const startImport = useOwnerMutation<ImportSession["provider"], ImportSession>({
    fallback: m.assets_the_import_session_could_not_be_started,
    request: (provider) => ({ path: `${mediaPath}/imports/${provider}/sessions`, method: "POST" }),
    invalidate: () => [],
  });
  const completeImport = useOwnerMutation<ImportSession, ImportCompleteResult>({
    fallback: m.assets_the_import_session_could_not_be_completed,
    request: (session) => ({
      path: `${mediaPath}/imports/${session.provider}/sessions/${session.id}/complete`,
      method: "POST",
    }),
    invalidate: (subject, _session, result) => (result?.ready ? refreshMedia(subject) : []),
  });

  return {
    upload,
    remove,
    requestDerivative,
    approve,
    retry,
    presentation,
    setCover,
    removeDerivative,
    startImport,
    completeImport,
  };
}
