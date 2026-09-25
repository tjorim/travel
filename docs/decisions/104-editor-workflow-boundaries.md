# Editor workflow boundaries

## Decision

Use the record-dialog pattern for a bounded CRUD record: creating a clean
record, inspecting one saved record, editing it, and deleting it. Its shared
dialog supplies the focus trap, Escape handling, return focus, dirty-form
discard prompt, and in-app deletion confirmation.

Keep workflows that have a wider task boundary inline in their workspace or on
a dedicated page. They must not open a record dialog merely to match the CRUD
screens.

## Boundaries

| Screen | Interaction boundary | Why it remains there |
| --- | --- | --- |
| Publication | Inline scope, link-record dialog | The public scope is reviewed in the workspace with its preview. A named share link is a normal trip record, so its name, scope and lifecycle use the standard dialog; its active URL can be opened and copied again by the owner. |
| Media import and review | Inline workspace section | Provider selection can leave the application and return later. Visit review branches into creating or attaching a reisupdate, while derivative approval and presentation are deliberately reviewed alongside the selected medium. These are multi-step flows, not a single media record. Direct device upload is the bounded exception and uses the record dialog. |
| Capture | Dedicated form page | Capturing a reisupdate is the purpose of the screen: it can restore an offline draft and includes optional private media, EXIF proposals, and place search. A dialog would constrain the primary mobile workflow. |
| Settings | Dedicated form page | Provider connection is account configuration, rather than a record in a list. Its temporary token is password-field input, submitted once, cleared after success, and never returned. |

## Safety and small screens

Owner-managed share URLs and rendered previews stay in the owner-only in-memory
cache and are not persisted by the PWA or placed in route parameters. Provider
tokens use mutation cache entries with zero GC time. The workflow
screens keep their single active surface: an inline scope, review, import, or
form; the upload dialog only contains the upload form and cannot launch a
second modal flow. An inline editor must still protect unsaved changes when an
owner switches context, and destructive lifecycle actions use the in-app
confirmation before making their request.

At 390px, workspace manager headings place their action beneath the text,
list-row actions wrap under their record text, grouped publication scopes stay
collapsed until needed, and the full-page Capture and Settings forms remain
within the shell. This keeps the visible workflow readable without horizontal
page overflow.

## Consequences

New CRUD managers should use `RecordDialog` and `useRecordDialog`. New
multi-step, secret-bearing, provider-handoff, or primary-page workflows should
state their interaction boundary here (or in their own decision record) and
test the important failure and secret-handling paths instead of being forced
into a record dialog.

This records the resolution of [#170](https://github.com/tjorim/travel/issues/170).
