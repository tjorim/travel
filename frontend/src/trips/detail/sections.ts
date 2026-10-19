import { m } from "../../paraglide/messages.js";

export const SECTIONS: { id: string; label: string }[] = [
  {
    id: "updates",
    get label() {
      return m.owner_travel_updates();
    },
  },
  {
    id: "visits",
    get label() {
      return m.owner_visits();
    },
  },
  {
    id: "stays",
    get label() {
      return m.owner_stays();
    },
  },
  {
    id: "routes",
    get label() {
      return m.owner_routes();
    },
  },
  {
    id: "tasks",
    get label() {
      return m.owner_tasks();
    },
  },
  {
    id: "locations",
    get label() {
      return m.owner_locations();
    },
  },
  {
    id: "areas",
    get label() {
      return m.owner_areas();
    },
  },
  {
    id: "documents",
    get label() {
      return m.owner_private_documents();
    },
  },
  {
    id: "media",
    get label() {
      return m.owner_private_media();
    },
  },
];
