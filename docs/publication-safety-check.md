# Publication safety check

Run this short review before publishing a trip's public view, activating or
rotating a named share link, or widening an already-live scope. The server
enforces the scope; this check is about choosing it deliberately.

## Before publishing or activating

- [ ] Open the rendered preview in the publication controls and read every
      shown item as a stranger would, then inspect the delivered fields. Do
      not rely only on the list of ticked items.
- [ ] Check that no selected text (titles, summaries, highlights, stage
      summaries, excerpts, captions, broad-route labels) contains an exact
      accommodation, home or meeting address, a booking or confirmation code,
      a flight or ticket number, a travel-party name or contact detail, or a
      live or near-real-time location. Stays, transport legs, the day plan and
      tasks are owner-only and cannot be selected; keep their details there.
- [ ] Choose trip dates only at the precision you intend to share (year,
      month or day), and prefer broad places and deliberately drawn routes.
- [ ] For every selected image, check the visible content and caption; only
      approved, metadata-stripped share derivatives can be selected.
- [ ] For a named link, choose the shortest sensible lifetime and send the
      capability only through a private channel.

## If something was shared by mistake

1. Remove the item or field from the scope, or unpublish the public view or
   revoke the link. Views are rendered live, so the next request no longer
   receives it; public and unlisted responses are sent `no-store`.
2. Rotate a named link if its capability itself reached the wrong people.
3. If a public page was indexed, request removal of its URL in the relevant
   search-engine webmaster tools.
4. Treat any exposed booking code, ticket or document as compromised and
   follow its provider's procedure (rebook, cancel or reissue).
