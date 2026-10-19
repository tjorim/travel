import type { ReactNode } from "react";

import { Empty, EmptyDescription, EmptyTitle } from "./empty";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Empty>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{children}</EmptyDescription>
    </Empty>
  );
}
