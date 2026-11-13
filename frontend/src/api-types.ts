// The records the API sends and receives, named for the screens. Every one is the type FastAPI generated
// for its response model in `api-schema.ts` (`pnpm api:generate`), so a field renamed or retyped in
// `backend/app/schemas.py` stops `pnpm typecheck` here. Declare no API record by hand: add a response
// model to the backend, regenerate, and alias it below.
import type {
  ExcludedRecord,
  TravelUpdateResponse as TravelUpdate,
  TripResponse,
  MergeRecordRef,
  ShareLinkResponse,
  ShareScope,
  SharingPresetReview,
} from "./api-schema";

export type {
  ProjectionAddress,
  ProjectionArea,
  ProjectionDates,
  ProjectionDocument,
  ProjectionDocument as Projection,
  ProjectionFile,
  ProjectionFile as ProjectionItem,
  ProjectionMedia,
  ProjectionNavigation,
  ProjectionPlace,
  ProjectionRoute,
  ProjectionRouteLine,
  ProjectionRouteMap,
  ProjectionRoutePoint,
  ProjectionStay,
  ProjectionUpdate,
  ProjectionVisit,
  AlternativeChoiceResponse as AlternativeChoice,
  AlternativeGroupKind as AlternativeKind,
  AlternativeGroupResponse as AlternativeGroup,
  AlternativeSuggestion,
  CurrentLocation,
  AreaMergeResult,
  AreaResponse as Area,
  AreaSuggestion,
  AuditEventKind,
  CollectionIndexDocument as CollectionIndex,
  CollectionIndexEntry as CollectionEntry,
  CollectionMemberResponse as CollectionMember,
  CollectionMembershipResponse,
  CollectionResponse as Collection,
  AuditEventResponse as AuditEvent,
  DatePrecision,
  DocumentAssetResponse as DocumentAsset,
  EmergencyInfoEntryResponse as EmergencyInfoEntry,
  EmergencyInfoKind,
  ExcludedRecord,
  ExclusionReview,
  ExclusionWideningDetail as ExclusionWidening,
  FollowAudienceAudience,
  GeoJsonLineString,
  FollowAudiencePrecisionResult as FollowAudienceResult,
  FutureDisclosure,
  ImportSessionCompleteResponse as ImportCompleteResult,
  ImportSessionResponse as ImportSession,
  LinkPresetApplyResult,
  LivePointResponse as LivePoint,
  LiveSessionResponse as LiveSession,
  LiveTrackPage,
  LocationInput,
  LocationMergeResult,
  LocationResponse as Location,
  MediaAssetResponse as MediaAsset,
  MediaDerivativeResponse as MediaDerivative,
  MediaTravelUpdateCandidateResponse as TravelUpdateCandidate,
  MediaTravelUpdateCandidatesResponse as TravelUpdateCandidatesResponse,
  MemberPresetApplyResult,
  MergeRecordRef,
  MergeWidenedRecord,
  MergeWidening,
  OAuthStartResponse,
  OverviewAudience,
  OverviewRecordPrecision,
  OverviewWarning,
  OwnerDocumentResponse as OwnerDocument,
  PlaceSearchResponse,
  PlaceSearchResult,
  PackingBagResponse as Bag,
  PackingItemResponse as Item,
  PackingListResponse as PackingList,
  PackingListSourceResponse as PackingSource,
  PackingSuggestionResponse as PackingSuggestion,
  PackingTemplateResponse as PackingTemplate,
  PlanningStatus,
  PrecisionCounts,
  PresetExceptions,
  PresetRecordRef,
  ProviderConnectionStatus,
  PublicTripCard,
  PublicPresetApplyResult,
  PublicProjectionStatusResponse as PublicProjectionStatus,
  RouteMode,
  RouteResponse as Route,
  ScopeExclusions,
  ShareLinkResponse as ShareLink,
  ShareScope,
  ShareScopeItem,
  ShareScopeKind,
  SharingPresetReview,
  StayResponse as Stay,
  TaskLink,
  TranslationDraftResponse,
  TravelUpdateResponse as TravelUpdate,
  TripOverviewResponse as TripOverview,
  TripResponse,
  TripSummaryResponse as TripSummary,
  TripTaskAlertResponse as TripTaskAlert,
  TripTaskResponse as TripTask,
  Visibility,
  VisitKind,
  VisitResponse as Visit,
} from "./api-schema";

// Shapes read straight out of a generated type, so they follow it.

/** A trip joined with its travel updates, as the owner's screens read it: the trip from the list, and the updates
 * from `/trips/{id}/travel-updates` (the trip itself no longer embeds them). */
export type Trip = TripResponse & { travel_updates: TravelUpdate[] };

/** Counts of records by kind, only the kinds with at least one. */
export type KindCounts = ExcludedRecord["hides"];
/** An opt-in visitor figure an audience may show. */
export type VisitorNumber = NonNullable<ShareScope["numbers"]>[number];
export type VisitorNumbers = Partial<Record<VisitorNumber, number>>;
/** The sharing presets (#241): named starting points for what one audience receives. */
export type SharingPresetId = SharingPresetReview["preset"];
export type PresetChangeAction = SharingPresetReview["changes"][number]["action"];
/** The label an audience carries after a preset was applied. It decides nothing about what is delivered. */
export type PresetLabel = Pick<
  ShareLinkResponse,
  "applied_preset" | "applied_preset_at" | "preset_exceptions"
>;
/** The result of applying a preset to any audience: the plan, and the audience as it now reads. */
export type PresetApplyResult<T> = { applied: boolean; review: SharingPresetReview; audience: T };
/** The kinds of moved record an owner can make private before a merge. */
export type MergeRecordKind = MergeRecordRef["kind"];
