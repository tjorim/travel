import type { Projection, ProjectionItem } from "@/api-types";
import { TripMap } from "@/components/map/TripMap";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ContentLanguage } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { cn } from "cn";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { ProjectionPlan, projectionPlan } from "./ProjectionPlan";
import { ProjectionStory } from "./ProjectionStory";
import { TripHeader, type TripCover } from "./TripHeader";
import { VisitorNumbers } from "./VisitorNumbers";
import { text, tripDates } from "./projectionFormatting";
import { projectionStoryMap, useProjectionMapMarkers } from "./projectionMapData";
import { focus, hasFileMarker, positiveSize } from "./projectionMedia";
import { groupStoryContext } from "./visitor-context";
import { DocumentLanguageProvider, useTextLang } from "./visitor-language";

export { tripDates, visitTimes } from "./projectionFormatting";
export { projectionMapLines, projectionMapPoints } from "./projectionMapData";

const CurrentLocations = lazy(() => import("./CurrentLocations"));

export type {
  Projection,
  ProjectionArea,
  ProjectionDates,
  ProjectionItem,
  ProjectionMedia,
  ProjectionPlace,
  ProjectionRoute,
  ProjectionStay,
  ProjectionUpdate,
  ProjectionVisit,
} from "@/api-types";

export type Audience = "public" | "share";
export type PreviewResources = {
  images: Record<string, string>;
  openFile: (id: string) => void;
  openNavigation: (id: string) => void;
};

const collections = [
  "visits",
  "places",
  "updates",
  "stays",
  "media",
  "routes",
  "navigation",
] as const;

type View = "story" | "map" | "plan";

const sideBySideQuery = "(min-width: 1100px)";

/** True once the viewport is wide enough for the story and map to sit side by side. */
function useSideBySide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(sideBySideQuery);
      query?.addEventListener?.("change", notify);
      return () => query?.removeEventListener?.("change", notify);
    },
    () => window.matchMedia?.(sideBySideQuery).matches ?? false,
    () => false,
  );
}

/**
 * A tab panel below 1100 px. Side by side every panel shows at once and the tab list is gone, so the
 * panels drop their tab semantics (and inert/hidden state) rather than claim a tablist that is absent.
 */
function ViewPanel({
  sideBySide,
  ...props
}: ComponentProps<typeof TabsContent> & { sideBySide: boolean }) {
  return (
    <TabsContent
      keepMounted
      {...(sideBySide
        ? {
            role: "presentation",
            hidden: false,
            inert: false,
            tabIndex: undefined,
            "aria-labelledby": undefined,
          }
        : {})}
      {...props}
    />
  );
}

export function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    document.schema_version ===
      (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1") &&
    (document.title === null || typeof document.title === "string") &&
    (document.cover == null || typeof document.cover === "string") &&
    (document.summary === null || typeof document.summary === "string") &&
    (document.summary_html == null || typeof document.summary_html === "string") &&
    (document.summary_text == null || typeof document.summary_text === "string") &&
    (document.dates === null ||
      (!!document.dates && typeof document.dates === "object" && !Array.isArray(document.dates))) &&
    collections.every(
      (key) =>
        Array.isArray(document[key]) &&
        (document[key] as unknown[]).every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as ProjectionItem).id === "string",
        ),
    )
  );
}

/** The areas this audience was shown, in the order the story meets them, for the header. */
const HEADER_DESTINATIONS = 4;
function tripDestinations(projection: Projection): string[] {
  const labels = [
    ...new Set(
      [...projection.visits, ...projection.stays, ...projection.updates]
        .map((item) => text(item.place?.label))
        .filter((label): label is string => label !== null),
    ),
  ];
  return labels.length > HEADER_DESTINATIONS
    ? [
        ...labels.slice(0, HEADER_DESTINATIONS),
        m.visitor_more_destinations({ count: labels.length - HEADER_DESTINATIONS }),
      ]
    : labels;
}

type ProjectionViewProps = {
  projection: Projection;
  audience: Audience;
  identifier: string;
  /** Where this document's files and navigation live when that is not `/api/{public/trips|shared}/{identifier}`. */
  apiBase?: string;
  previewResources?: PreviewResources;
  /** An update of this document to bring into view and focus on first show, as the owner's preview does. */
  focusId?: string;
  /**
   * The language the document's unmarked authored texts are in (the language it was requested in, else the trip's
   * own, as the server says), so each is marked with it for screen readers. The page translates nothing itself.
   */
  language?: ContentLanguage | null;
};

export function ProjectionView({ language, ...props }: ProjectionViewProps) {
  return (
    <DocumentLanguageProvider language={language}>
      <ProjectionBody {...props} />
    </DocumentLanguageProvider>
  );
}

function ProjectionBody({
  projection,
  audience,
  identifier,
  apiBase,
  previewResources,
  focusId,
}: Omit<ProjectionViewProps, "language">) {
  const locale = useLocale();
  const lang = useTextLang();
  const deliveryBase =
    apiBase ??
    `${audience === "public" ? "/api/public/trips" : "/api/shared"}/${encodeURIComponent(identifier)}`;
  const sideBySide = useSideBySide();
  const [view, setView] = useState<View>("story");
  const [activeUpdate, setActiveUpdate] = useState<string | null>(null);
  // The map moves with the reader by default; a visitor who wants to look around on their own can turn that off.
  const [followStory, setFollowStory] = useState(true);
  const { mapLines, mapPoints } = useProjectionMapMarkers(projection, locale);
  const story = useMemo(() => groupStoryContext(projection), [projection]);
  useEffect(() => {
    if (previewResources) return;
    const revealFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      const target = document.getElementById(fragment);
      // Records grouped under an update live in the story, so their anchors reveal it, not the plan.
      const inStory =
        projection.updates.some((item) => fragment === item.id) ||
        target?.closest("[data-update-context]") != null;
      if (!target) return;
      setView(inStory ? "story" : "plan");
      requestAnimationFrame(() => {
        target.scrollIntoView?.();
        target.focus({ preventScroll: true });
      });
    };
    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    return () => window.removeEventListener("hashchange", revealFragment);
  }, [projection, previewResources]);
  const navigation = new Set(projection.navigation.map((item) => item.id));
  const navigationLink = (item: ProjectionItem) => {
    if (!navigation.has(item.id)) return null;
    if (previewResources)
      return (
        <Button
          className="mt-2.5 bg-transparent p-0 text-travel-forest underline underline-offset-3"
          type="button"
          onClick={() => previewResources.openNavigation(item.id)}
        >
          {m.visitor_directions()}
        </Button>
      );
    return (
      <a
        href={`${deliveryBase}/navigation/${encodeURIComponent(item.id)}`}
        referrerPolicy="no-referrer"
        rel="noreferrer"
      >
        {m.visitor_directions()}
      </a>
    );
  };
  const fileUrl = (item: ProjectionItem) =>
    previewResources
      ? (previewResources.images[item.id] ?? null)
      : `${deliveryBase}/files/${encodeURIComponent(item.id)}`;
  const empty = collections.every((key) => projection[key].length === 0);
  const dates = tripDates(projection.dates);
  // The cover is a photo the server already delivers to this audience; nothing here can fetch another.
  const coverItem =
    typeof projection.cover === "string"
      ? projection.media.find(
          (item) => item.id === projection.cover && hasFileMarker(item, "image"),
        )
      : undefined;
  const cover: TripCover | null = coverItem
    ? {
        url: fileUrl(coverItem),
        alt: text(coverItem.alt_text) ?? "",
        altLang: text(coverItem.alt_text) ? lang(coverItem.alt_text_lang) : undefined,
        caption: {
          html: text(coverItem.caption_html),
          text: text(coverItem.caption),
          lang: lang(coverItem.caption_lang),
        },
        focalX: focus(coverItem, "focal_x"),
        focalY: focus(coverItem, "focal_y"),
        width: positiveSize(coverItem, "width"),
        height: positiveSize(coverItem, "height"),
      }
    : null;
  const hasMap = mapLines.length > 0 || mapPoints.length > 0;
  const { mapBesideStory, followed, mapPhotos } = projectionStoryMap(
    projection,
    mapPoints,
    hasMap,
    activeUpdate,
    fileUrl,
    openUpdate,
  );
  /** Brings an update into view and focuses it, as following its index link would. */
  function openUpdate(id: string) {
    setView("story");
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView?.({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      target?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (focusId && projection.updates.some((item) => item.id === focusId)) openUpdate(focusId);
    // Only a different requested update re-aims the view, not each rendering of the same one.
  }, [focusId, projection]);
  const plan = projectionPlan(projection, story.separate);
  const header = (
    <>
      <TripHeader
        title={projection.title ?? m.shared_trip()}
        titleLang={projection.title ? lang(projection.title_lang) : undefined}
        eyebrow={previewResources ? m.publication_travel_preview() : "Travel"}
        level={previewResources ? "h2" : "h1"}
        dates={dates}
        destinations={tripDestinations(projection)}
        cover={cover}
      />
      <VisitorNumbers numbers={projection.numbers ?? undefined} />
      {!!projection.current_locations?.length && (
        <Suspense fallback={null}>
          <CurrentLocations positions={projection.current_locations} />
        </Suspense>
      )}
    </>
  );
  if (empty && !projection.summary && !dates)
    return (
      <div className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}>
        {header}
        <Alert className="travel-card" role="status">
          <h2>{m.visitor_no_content()}</h2>
          <p>{m.visitor_no_content_description()}</p>
        </Alert>
      </div>
    );

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setView(next as View)}
      className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}
    >
      {header}
      <div className="min-[1100px]:hidden">
        <TabsList aria-label={m.visitor_view()} activateOnFocus>
          <TabsTrigger value="story">{m.visitor_story()}</TabsTrigger>
          {hasMap && <TabsTrigger value="map">{m.visitor_map()}</TabsTrigger>}
          {plan.detailSections > 0 && <TabsTrigger value="plan">{m.visitor_plan()}</TabsTrigger>}
        </TabsList>
      </div>
      <div className={hasMap ? "travel-story-map" : "grid min-w-0"}>
        <ViewPanel value="story" sideBySide={sideBySide} className="grid gap-travel-grid-gap">
          <ProjectionStory
            projection={projection}
            fileUrl={fileUrl}
            onActive={setActiveUpdate}
            context={story.byUpdate}
            navigationLink={navigationLink}
          />
        </ViewPanel>
        {hasMap && (
          <ViewPanel value="map" sideBySide={sideBySide} data-story-map="">
            {mapBesideStory && (
              <Field className="mb-2.5 hidden min-[1100px]:block">
                <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                  <Switch checked={followStory} onCheckedChange={setFollowStory} />
                  <span>{m.visitor_map_follows_story()}</span>
                </FieldLabel>
              </Field>
            )}
            <TripMap
              wide
              bare
              headingLevel={2}
              points={mapPoints}
              lines={mapLines}
              follow={followStory ? followed : null}
              photos={mapPhotos}
            />
          </ViewPanel>
        )}
      </div>
      <ViewPanel value="plan" sideBySide={sideBySide} className="grid gap-travel-grid-gap">
        <ProjectionPlan projection={projection} details={plan} navigationLink={navigationLink} />
      </ViewPanel>
    </Tabs>
  );
}
