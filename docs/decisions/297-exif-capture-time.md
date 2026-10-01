# EXIF capture times without an offset (#297)

EXIF `DateTimeOriginal` is the camera's wall-clock time and normally has no zone.
It was stored as UTC and formatted in the viewer's browser zone, so a photo taken
at 10:15 in Taiwan showed as 11:15 to an owner in Brussels.

## Decision: keep the wall time as written (option 2)

- **Stored as written.** The value goes into `media_assets.captured_at` with a
  nominal UTC label (the column needs one) and `media_assets.captured_local =
  true`. The flag, not the label, says it is not an instant.
- **Shown unchanged.** The owner API returns `captured_local` on assets, on
  candidate time options and on the candidate. The PWA formats a local time with
  `formatCapture` (UTC fields of the value) and fills the capture dialog with the
  same clock, so 10:15 in Taiwan is 10:15 for an owner in any zone.
- **Nothing is guessed.** No zone is taken from areas, the trip or GPS. That
  would need a rule for when they disagree and a fallback for when there is none,
  and it would use location data automatically, which the privacy rules rule
  out. Asking the owner for a camera offset per import (option 3) and keeping UTC
  with a hint (option 4) were not chosen: the first adds a step for a convenience
  value, the second leaves the wrong time on screen.
- **Offsets still help grouping.** When the camera wrote `OffsetTimeOriginal`, the
  offset is kept in the owner-only `raw_metadata.exif.captured_utc_offset_minutes`
  and candidate grouping uses the real instant; the displayed time stays the
  written clock. Without an offset, times are compared as written, which holds
  within one camera. Grouping runs on the server and never reads the viewer's zone.
- **Provider times stay instants.** A provider's `createTime` is only a fallback
  when a photo has no usable EXIF time; it has `captured_local = false` and is
  shown in the viewer's zone as before.
- **Existing media.** Migration `009_media_captured_local` adds the column as
  `false`. Earlier rows keep their value and display: the original file is the
  only record of whether the time was bare, and a migration does not read object
  storage. Re-uploading identical bytes returns the existing record, so it is not
  re-derived either.
