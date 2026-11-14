# One audience, three stores (#360)

Decision: 2026-11-14, issue [#360](https://github.com/tjorim/travel/issues/360), decided by the owner.

## Depth

Issue #360 offered three depths for treating the public view, a hidden link and a collection member as one
**audience**: code only, API too, or storage too. The owner chose **option 1, code only**.

- One interface, `app.audience.Audience`, with a subclass per kind (`PublicAudience`, `LinkAudience`,
  `MemberAudience`). Everything an audience feature needs to ask lives on it: scope, revision, the applied preset
  label and time, whether it delivers now (`live`), whether the owner may still edit it (`editable`), whether it
  may exclude records, the document schema a visitor receives, where its history is written (`audit_target`) and
  whether live location may name it (`live_location_key`).
- Each audience feature is written **once**, over that interface, in `app.services.audiences`: finding the
  audience an owner addresses, previewing it (document, file, navigation target), the future-disclosure review, the
  revision claim, and the scope edit with its widening refusal and audit entry. The preset review and apply
  (`app.sharing_presets`, `app.services.sharing_presets`), the live-location settings (`app.services.live_location`),
  the lists of a trip's audiences (`audit.live_audiences`, `access.trip_audiences`, `live_scopes`, the preset's
  "other audiences" check, all now `audience.audiences_of_trip`) and the owner's and the visitor's document
  (`audiences.render_document`) take it too.
- **Unchanged on purpose:** the three tables, every route and its method, the `confirm_widening` placement (a body
  field of the link update, a query parameter of the member update), every payload (`PublicProjectionStatusResponse`,
  `ShareLinkResponse`, `CollectionMemberResponse`), the stored values (`public_surface`, `share_link`,
  `collection.member_scope_change`), the audience keys of a preset and an audit entry (`public`, `link:<id>`,
  `collection:<member id>`), the MCP tool names, and the OpenAPI snapshot. No migration. What each audience receives
  is decided where it always was (`projection.delivered`), and the projection golden tests pass unchanged.

Options 2 (one set of routes addressed by an audience id) and 3 (one `audiences` table, which would also give live
location a real foreign key) stay open. Neither is needed for the acceptance, each changes the API or the storage
that clients and backups depend on, and either can be built on this interface later: the routes and the table would
only replace the lookup that finds the `Audience`.

## Names

One name per concept. Documents, comments, messages and new code use the left column; the right column lists what
stays because it is a stored value, a route, a tool name or the interface's own copy.

| Concept | Name | Stays as it is (storage and wire) |
|---|---|---|
| Anything that receives a trip through a scope | **audience** | `LiveSession.audiences` and `audiences` in the live-location API |
| The page for everyone, once published | **public view** (`PublicAudience`) | table `public_surfaces`, row `PublicSurface`, audit target `public_surface`, routes and MCP tools `public-projection` / `public_projection.*`, key `"public"`, document schema `travel/public-trip@1`, the interface's "public page" copy |
| A named, revocable link for one trip | **hidden link** (`LinkAudience`) | table `share_links`, row `ShareLink`, audit target `share_link`, routes `share-links`, key `link:<id>`, the `/share/` path and the frontend `"share"` view, schema `travel/unlisted-trip@1` |
| One trip inside a collection | **collection member** (`MemberAudience`) | table `collection_members`, row `CollectionMember`, key `collection:<member id>`, `collection.member_*` audit kinds |
| The owner-wide link that opens several trips | **collection** (not an audience; its members are) | table `collections`, routes `collections` |

Not used any more in prose: *public surface*, *public projection* and *public page* for the audience, *unlisted view*
and *share link* for the owner's concept (the last three remain wherever the right column names them). A function that
mirrors a route or an MCP tool keeps that API's word (`set_public_projection_scope`, `create_share_link`); anything
that works over every kind says `audience`, and anything specific to one says `public`, `link` or `member`.

`Audience.id` is the audience key above (as `PresetAudience.id` and `LiveAudience.id` were); `Audience.record_id` is
the id of the stored row.

## What is the same for every audience now

Preview of the saved scope or an unsaved candidate (validated like a save, the public view without exclusions),
the document with the current live location, a preview file and navigation target, the future-disclosure review, the
revision claim with its `412` body, the widening refusal and its audit details, the audit entry of a scope change and
of a preset apply (on the trip's trail for a public view or link, on the collection's trail for a member, naming the
member), the exclusions a preset may write, the state in which an audience is editable, and the live-location
setting that goes with an audience that stops delivering.

## A collection member and a hidden link

They now run the same code for everything above. The differences that remain are decisions, not copies:

- **Live location.** A member has no `live_location_key`: live location names the public view or one hidden link,
  never a collection member ([decision 244](244-live-location-tracks.md)). A member's document carries no
  `current_locations`, as before.
- **Future-disclosure.** The review itself (`audiences.review_future`) takes any audience and a service function
  exists for a member (`collections.review_member_future`), so a member has the same check. It has no route, MCP tool
  or screen yet: adding a route changes the OpenAPI document, which this decision keeps unchanged. The route, the
  tool and the screen for a member are tracked in [#426](https://github.com/tjorim/travel/issues/426).
- **Widening acknowledgement.** The field stays where each route has always had it (see above); both reach one
  refusal, `exclusion_widening_needs_acknowledgement`.
- **Lifecycle.** A link has its own token, rotation and feed; a member shares its collection's capability and
  state. Minting a capability (`sharing.mint_capability`) and settling an expired one (`sharing.settle_expired`) are
  shared by links and collections.

## Verification

The projection golden tests (`test_projection_contract`, `test_legacy_scope_golden`, `test_legacy_exclusion_golden`,
`test_area_only_stay_golden`), the sharing, collection, preset and live-location suites and the OpenAPI snapshot pass
without a change to what they assert. Test code that built a `PresetAudience` by hand now builds the matching
`Audience`, and one test that called `claim_revision` on a row calls it on an `Audience`.
