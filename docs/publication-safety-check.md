# Publication safety check

Run this short review before publishing a trip's public view, activating or
rotating a named share link, or widening an already-live scope. The server
enforces the scope; this check is about choosing it deliberately.

## Before publishing or activating

- [ ] Open the rendered preview in the publication controls and read every
      shown item as a stranger would, then inspect the delivered fields. Do
      not rely only on the list of ticked items.
- [ ] List every record set to "Iedereen" (`everyone`), in "Zichtbaarheid per
      onderdeel" in Delen: it reaches the public page and every hidden link
      without being ticked, so read each one as a stranger would. "Privé"
      records reach nobody.
- [ ] Check that no shared text (titles, summaries, stage summaries, the text
      written for visitors in a reisupdate, public location names, captions,
      route labels) contains an exact
      accommodation, home or meeting address, a booking or confirmation code,
      a ticket document, a travel-party name or contact detail, or a live or
      near-real-time location. A selected route may show its
      mode, its two areas, a carrier, flight/service number, schedule, status
      and drawn line, but never a location's address, a booking code, travel
      class, notes or document.
- [ ] Choose trip dates only at the precision you intend to share (year,
      month or day), and prefer areas and deliberately drawn routes.
- [ ] A reisupdate shares only its title, the text written for visitors, its
      date and its area; never its private notes. Read the text as a stranger
      would, and remember the date precision applies.
- [ ] A shared location (a monument, a hot spring) shows its public name, city and
      point. Do not share a place that is a home, a hotel or a meeting point.
- [ ] A shared stay shows only its area and its nights at the precision you
      chose, never the property. Check that the area is not too specific.
- [ ] A route appears on the map with your drawn line, or as a straight line
      between its two areas. Its stations or airports show only when you share
      those locations under their public names; check the line does not pass
      close to a home or meeting point.
- [ ] For every selected image, check the visible content and caption; only
      approved, metadata-stripped photo or video derivatives can be selected.
- [ ] A photo of an update is also pinned on the map, as a round marker at the
      area that update shares, and the map eases to that area while the reader
      is at the update. The marker shows only a photo the audience already
      receives, at a place it already sees; check that the area is not too
      specific for the photo, because the pin ties the two together.
- [ ] If the trip has a cover, check that photo like any other shared image:
      choosing it publishes nothing, so it is shown only to audiences that already
      receive it. The sharing check lists an audience that receives no cover.
- [ ] Documents in the owner-wide library and trips have no scope choice, visitor field, or file route.
- [ ] For a named link, choose the shortest sensible lifetime and send the
      capability only through a private channel.

## If something was shared by mistake

1. Set the record back to "Privé" (or remove it from the scope), or unpublish the public view or
   revoke the link. Views are rendered live, so the next request no longer
   receives it; public and unlisted responses are sent `no-store`.
2. Rotate a named link if its capability itself reached the wrong people.
3. If a public page was indexed, request removal of its URL in the relevant
   search-engine webmaster tools.
4. Treat any exposed booking code, ticket or document as compromised and
   follow its provider's procedure (rebook, cancel or reissue).
