import type { RouteMode } from "@/api-types";

export type MapLink = { label: string; href?: string; onOpen?: () => void };
export type MapPoint = {
  id: string;
  label: string;
  coordinates: [number, number];
  kind?: "mountain" | "stay" | "airport" | "place" | "area" | "derived" | "location";
  areaId?: string;
  detail?: string;
  dates?: string;
  links?: MapLink[];
};
export type MapLine = {
  id: string;
  label: string;
  coordinates: [number, number][];
  transport?: RouteMode;
  from?: string;
  to?: string;
  dates?: string;
  links?: MapLink[];
};
/** An approved photo of a shared update, pinned where that update's shared area sits. */
export type MapPhoto = {
  id: string;
  /** The map point the photo belongs to; the marker lights up while the story is at that point. */
  pointId: string;
  coordinates: [number, number];
  url: string;
  label: string;
  onOpen: () => void;
};
export type MapPerspective = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  label?: string;
  exaggeration?: number;
};

export type TripMapProps = {
  points: MapPoint[];
  lines: MapLine[];
  owner?: boolean;
  collapseLists?: boolean;
  /** A visitor map beside the trip context: taller on wide screens, as the owner map is. */
  wide?: boolean;
  /**
   * Below the width where the map sits beside the story, drop the card around the map and keep its heading for
   * assistive technology only, so the map itself gets the room; the canvas also grows to most of the window.
   */
  bare?: boolean;
  /** The level of the map's own heading; the point and route lists sit one level below it. */
  headingLevel?: 2 | 3;
  perspective?: MapPerspective;
  styleUrl?: string;
  focus?: { id: string; request: number } | null;
  /** The point the story is at: the map eases to it and rings it, without opening its details. */
  follow?: string | null;
  /** Photos from the story pinned on the map; a click or tap opens the update. They are for pointer users only. */
  photos?: MapPhoto[];
  onUseDerived?: (point: MapPoint) => void;
};
