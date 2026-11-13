import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { FieldLegend, FieldSet } from "@/ui/field";
import { Input } from "@/ui/input";
import { CameraIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { useRef, type ChangeEvent } from "react";

import { useAuth } from "../../auth-context";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { MediaAsset } from "../../api-types";
import { OwnerImage } from "../OwnerImage";
import type { CaptureUpload } from "./use-capture-uploads";

const tile = cn(
  "relative aspect-square min-w-0 overflow-hidden rounded-travel-media border border-travel-card-border bg-travel-tint",
);
const tileImage = cn("size-full object-cover");
const overlayButton = cn(
  "absolute top-1 right-1 flex items-center justify-center rounded-full border-0 bg-travel-lightbox/70 p-0 text-travel-lightbox-ink",
);

/** The photos of the update, first thing in Capture: choose or take some, see them as thumbnails and take one away. */
export function CapturePhotos({
  photoIds,
  assets,
  uploads,
  online,
  onAdd,
  onRemove,
  onRetry,
  onDropUpload,
}: {
  /** The photos linked to the draft, in order. */
  photoIds: string[];
  /** The linked photos that are known; a restored draft may name photos still being read. */
  assets: MediaAsset[];
  uploads: CaptureUpload[];
  online: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (assetId: string) => void;
  onRetry: (key: string) => void;
  onDropUpload: (key: string) => void;
}) {
  useLocale();
  const { session } = useAuth();
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // The same photo can be chosen again later, so the input must not remember it.
    event.target.value = "";
    if (files.length) onAdd(files);
  }

  return (
    <FieldSet className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
      <FieldLegend className="mb-2 p-0 font-bold text-travel-label">
        {m.capture_photos()}
      </FieldLegend>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="secondary flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-center font-bold"
          disabled={!online}
          onClick={() => library.current?.click()}
        >
          <ImagePlusIcon className="size-5" aria-hidden="true" />
          {m.capture_choose_photos()}
        </Button>
        <Button
          type="button"
          className="secondary hidden flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-center font-bold pointer-coarse:flex"
          disabled={!online}
          onClick={() => camera.current?.click()}
        >
          <CameraIcon className="size-5" aria-hidden="true" />
          {m.capture_take_photo()}
        </Button>
        <Input
          ref={library}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={m.capture_choose_photos()}
          onChange={picked}
        />
        <Input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label={m.capture_take_photo()}
          onChange={picked}
        />
      </div>
      {!online && (
        <p className="m-0 text-sm text-travel-muted" role="status">
          {m.capture_photos_offline()}
        </p>
      )}
      {(photoIds.length > 0 || uploads.some((upload) => upload.status === "uploading")) && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 min-[460px]:grid-cols-4 min-[621px]:grid-cols-6">
          {photoIds.map((id) => {
            const asset = assets.find((entry) => entry.id === id);
            const name = asset?.original_filename ?? m.owner_unnamed_photo();
            const source = asset ? (asset.thumbnail_url ?? asset.file_url) : null;
            return (
              <li className={tile} key={id} data-photo={id}>
                {session && source ? (
                  <OwnerImage session={session} url={source} alt={name} className={tileImage} />
                ) : (
                  <span className="media-thumbnail-placeholder size-full" aria-hidden="true" />
                )}
                <Button
                  type="button"
                  className={overlayButton}
                  aria-label={m.capture_remove_photo({ name })}
                  onClick={() => onRemove(id)}
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
          {uploads
            .filter((upload) => upload.status === "uploading")
            .map((upload) => (
              <li className={tile} key={upload.key} data-upload="uploading">
                {upload.previewUrl && (
                  <img className={cn(tileImage, "opacity-60")} src={upload.previewUrl} alt="" />
                )}
                <span
                  className="absolute inset-0 flex items-center justify-center text-travel-ink"
                  role="status"
                  aria-label={m.capture_uploading_photo({ name: upload.name })}
                >
                  <Spinner className="size-6" />
                </span>
              </li>
            ))}
        </ul>
      )}
      {uploads.some((upload) => upload.status === "failed") && (
        <ul className="m-0 grid list-none gap-2 p-0">
          {uploads
            .filter((upload) => upload.status === "failed")
            .map((upload) => (
              <li className="form-error grid gap-2" key={upload.key}>
                <span role="alert" className="break-words">
                  {upload.error
                    ? `${m.capture_upload_failed({ name: upload.name })} ${upload.error}`
                    : m.capture_upload_failed({ name: upload.name })}
                </span>
                <div className="button-row">
                  <Button
                    type="button"
                    className="secondary compact"
                    aria-label={m.capture_retry_upload_named({ name: upload.name })}
                    onClick={() => onRetry(upload.key)}
                  >
                    {m.capture_retry_upload()}
                  </Button>
                  <Button
                    type="button"
                    className="secondary compact"
                    aria-label={m.capture_remove_photo({ name: upload.name })}
                    onClick={() => onDropUpload(upload.key)}
                  >
                    {m.capture_remove()}
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </FieldSet>
  );
}
