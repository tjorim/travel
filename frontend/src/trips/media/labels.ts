import { m } from "../../paraglide/messages.js";

export const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

export const purposeLabel = {
  get share() {
    return m.common_sharing();
  },
  get owner_preview() {
    return m.media_private_preview();
  },
} as const;
