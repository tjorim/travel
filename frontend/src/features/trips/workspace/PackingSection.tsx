import { PackingManager } from "../packing/PackingManager";
import type { SectionProps } from "./workspace-sections";

/** The workspace's packing tab. */
export default function PackingSection({ trip }: SectionProps) {
  return <PackingManager trip={trip} />;
}
