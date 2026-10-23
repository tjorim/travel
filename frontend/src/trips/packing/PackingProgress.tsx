import { Progress } from "@/ui/progress";

import { useLocale } from "../../locale";
import type { Item } from "./model";

export function PackingProgress({ rows, label }: { rows: Item[]; label: string }) {
  useLocale();
  return (
    <Progress.Root
      aria-label={label}
      value={rows.filter((item) => item.packed).length}
      max={Math.max(rows.length, 1)}
      className="block w-full"
    >
      <Progress.Track className="block h-2 overflow-hidden rounded-full bg-travel-tint">
        <Progress.Indicator className="h-full rounded-full bg-travel-forest" />
      </Progress.Track>
    </Progress.Root>
  );
}
