import { m } from "../../paraglide/messages.js";

export const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

export const purposeLabel = {
  get share() {
    return m.owner_sharing();
  },
  get static_export() {
    return m.assets_static_archive();
  },
  get owner_preview() {
    return m.assets_private_preview();
  },
} as const;
