# Locale-aware date and time fields (#293)

Native `<input type="date">`, `time` and `datetime-local` draw in the browser's
locale, so a Dutch interface showed `mm/dd/yyyy` and 12-hour clocks in an
English browser. The owner forms now use `DateField`, `TimeField` and
`DateTimeField` (`frontend/src/forms/DateTimeFields.tsx`).

## Decisions

- **Text plus calendar.** A date is a text input with a calendar button.
  Typing "16 nov 2026", "16 november 2026", "16-11-2026", "16.11.2026" or ISO is
  accepted (numbers are day-first in both languages); the field shows
  "16 nov 2026" in Dutch and "16 Nov 2026" in English. The calendar is the
  shadcn Calendar (react-day-picker v10) on a Base UI Popover, generated with the
  CLI and restyled with `--color-travel-*` tokens. Weeks start on Monday, names
  and accessible labels come from the react-day-picker `nl` and `en-GB` locales,
  and the locale follows `useLocale()`, not a hard-coded language.
- **24-hour time in both languages.** A time is a text input that reads "18:30",
  "18.30", "1830", "9:30" and "18", and "6:30 pm" for 12-hour habits; it always
  shows `HH:mm`. There is no time popover: typing is faster than a list.
- **Date-time is two inputs.** A date-time is a date field and a time field in a
  labelled group. The form value stays `YYYY-MM-DDTHH:mm` and is empty until both
  parts are valid. A half-filled date-time shows an error and blocks the save,
  where the native input silently saved nothing. Time-zone semantics are
  unchanged: the value is the place's local time, paired with the zone field.
- **Machine values unchanged.** Forms, validators and payloads still see
  `YYYY-MM-DD`, `HH:mm` and `YYYY-MM-DDTHH:mm`, so every existing validation and
  API payload is untouched.
- **Unreadable text blocks the save.** While the text cannot be read, the form
  keeps the last valid value and the input carries `data-unreadable`;
  `RecordForm` (and the capture form) refuses to submit, focuses that input and
  shows the error. The error appears after the field is left, not while typing.
- **Phones: custom everywhere.** The issue asked whether phones should keep
  native pickers. They do not: the native pickers follow the device locale and
  clock, which is the defect, and two behaviours in one form would be harder to
  test and explain. Phones instead get 44 px calendar cells and buttons, the
  numeric keyboard on time fields, and typed entry, which is also fast on a
  phone keyboard.
- **Dependencies.** `react-day-picker` (with its `date-fns` and `@date-fns/tz`
  dependencies) is accepted. dayjs stays the app's formatting library; the picker
  only works on local calendar dates, converted to and from ISO strings, so the
  two do not interact. Everything is bundled, so the pickers work offline. Base
  UI 1.8 has no date components; revisit if a public temporal API ships.
- **Accessibility.** The calendar is an arrow-key grid with translated labels and
  focus moves into it when it opens. Closing returns focus to the text input.
  Each part of a date-time has its own accessible name ("Vertrek, datum" / "Vertrek,
  tijd").

## Tests

Tests type into the inputs with `fireEvent.change`; ISO, displayed and numeric
forms are all accepted, so fixtures can keep sending ISO. Assertions on what the
inputs show expect the displayed form. `src/test-dates.ts` types and reads a
date-time.
