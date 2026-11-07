import { useEffect, useState } from "react";

export type SheetFit = { lift: number; height: number };

/**
 * Keeps a bottom sheet inside the part of the screen the on-screen keyboard leaves. Phone browsers keep the layout
 * viewport and shrink only the visual one when a keyboard opens, so a sheet pinned to the layout bottom would put
 * its Save button under the keys. Returns the room left for the sheet, or undefined while no keyboard is in the way.
 */
export function useVisualViewportFit(active: boolean): SheetFit | undefined {
  const [fit, setFit] = useState<SheetFit | undefined>(undefined);
  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !viewport) {
      setFit(undefined);
      return;
    }
    const measure = () => {
      const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
      const next = covered > 1 ? { lift: covered, height: Math.round(viewport.height) } : undefined;
      setFit((current) =>
        current?.lift === next?.lift && current?.height === next?.height ? current : next,
      );
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [active]);
  return fit;
}
