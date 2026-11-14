import { m } from "../../paraglide/messages.js";

export const SECTIONS: { id: string; label: string }[] = [
  {
    id: "updates",
    get label() {
      return m.common_travel_updates();
    },
  },
  {
    id: "visits",
    get label() {
      return m.common_visits();
    },
  },
  {
    id: "stays",
    get label() {
      return m.common_stays();
    },
  },
  {
    id: "routes",
    get label() {
      return m.common_routes();
    },
  },
  {
    id: "tasks",
    get label() {
      return m.common_tasks();
    },
  },
  {
    id: "locations",
    get label() {
      return m.common_locations();
    },
  },
  {
    id: "areas",
    get label() {
      return m.common_areas();
    },
  },
  {
    id: "documents",
    get label() {
      return m.common_private_documents();
    },
  },
  {
    id: "media",
    get label() {
      return m.common_private_media();
    },
  },
];
