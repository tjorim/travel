import { Button } from "@base-ui/react/button";
import { CloudOffIcon, RefreshCwIcon } from "lucide-react";
import { Component, Suspense, lazy, type ComponentType, type FC, type ReactNode } from "react";

import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import { Skeleton } from "./ui/skeleton";

/** A deferred module that could not be fetched, as opposed to a view that failed while rendering. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super("chunk_load_failed", { cause });
    this.name = "ChunkLoadError";
  }
}

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

async function load<P>(loader: Loader<P>) {
  try {
    return await loader();
  } catch (error) {
    throw new ChunkLoadError(error);
  }
}

/** Fades in after a moment, so a chunk that arrives at once never flashes a placeholder. */
function ViewLoading() {
  useLocale();
  return (
    <section
      className="travel-card grid min-h-48 content-start gap-3 animate-travel-delayed-in motion-reduce:animate-none"
      role="status"
    >
      <p className="m-0 text-sm font-bold text-travel-muted">{m.owner_view_loading()}</p>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </section>
  );
}

function ViewFailed({ overlay }: { overlay: boolean }) {
  useLocale();
  const card = (
    <section className="travel-card grid justify-items-start gap-3" role="alert">
      <CloudOffIcon className="size-7 text-travel-muted" aria-hidden="true" />
      <h2 className="m-0 text-xl">{m.owner_view_unavailable()}</h2>
      <p className="m-0 leading-normal text-travel-muted">
        {m.owner_view_unavailable_description()}
      </p>
      <Button
        className="compact mt-1 inline-flex items-center gap-2"
        type="button"
        onClick={() => window.location.reload()}
      >
        <RefreshCwIcon className="size-4" aria-hidden="true" />
        {m.owner_view_reload()}
      </Button>
    </section>
  );
  return overlay ? (
    <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md">{card}</div>
  ) : (
    card
  );
}

/**
 * Catches only a failed module fetch. A browser remembers a failed import of the same URL for the life of the page,
 * so importing again cannot recover; the one honest action is a reload, which re-requests the page's modules and
 * re-submits nothing. Any other error keeps propagating to the nearest boundary above.
 */
class ChunkBoundary extends Component<
  { children: ReactNode; overlay: boolean },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    if (error instanceof ChunkLoadError) return { failed: true };
    throw error;
  }

  componentDidCatch(error: unknown) {
    if (error instanceof ChunkLoadError) console.error(error);
  }

  render() {
    return this.state.failed ? <ViewFailed overlay={this.props.overlay} /> : this.props.children;
  }
}

/**
 * A component whose module is fetched on first render. The loading and failure states render in place of the
 * component, so the surrounding layout (navigation, a workspace's header) stays mounted and usable. A dialog passes
 * `overlay`: it has no place in the page flow, so it shows nothing while loading and a floating card on failure.
 */
export function lazyView<P extends object>(
  loader: Loader<P>,
  { overlay = false }: { overlay?: boolean } = {},
): FC<P> {
  const View = lazy(() => load(loader)) as ComponentType<P>;
  return function LazyView(props: P) {
    return (
      <ChunkBoundary overlay={overlay}>
        <Suspense fallback={overlay ? null : <ViewLoading />}>
          <View {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  };
}

/** `lazyView` for a module with a named export; the other exports of the module do not affect the props. */
export function lazyNamed<M extends object, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
  options?: { overlay?: boolean },
): M[K] extends ComponentType<infer P> ? FC<P> : never {
  type Props = M[K] extends ComponentType<infer P> ? P : never;
  return lazyView(
    async () => ({
      default: (await loader())[name] as ComponentType<Props & object>,
    }),
    options,
  ) as never;
}
