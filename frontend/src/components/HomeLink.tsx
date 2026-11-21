import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * A small text link between the two places a thing is reachable from: a trip's documents and the library, or a
 * trip's sharing and the sharing overview. It is a plain router link; the destination keeps the URL.
 */
export function HomeLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center font-bold text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
      to={to}
    >
      {children}
    </Link>
  );
}
