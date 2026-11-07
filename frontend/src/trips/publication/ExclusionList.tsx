import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { ExcludedRecord, ShareScope, ShareScopeKind } from "../../tracker-model";
import {
  GROUP_TITLES,
  groupBy,
  isExcluded,
  kindCountsText,
  setShown,
  type CatalogItem,
} from "./catalog";
import { useExclusionReview } from "./use-exclusion-review";

/**
 * What a hidden link or collection member receives from the public baseline, one checkbox per record set to
 * Everyone. A ticked record is shown on this audience (the default); unticking it leaves it out of this audience
 * only. The server says what else an unticked area, location or update hides with it, so the note under a record is
 * the same count the delivery applies.
 */
export function ExclusionList({
  scope,
  setScope,
  catalog,
  tripId,
  disabled = false,
}: {
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  catalog: CatalogItem[];
  tripId: string;
  disabled?: boolean;
}) {
  useLocale();
  const review = useExclusionReview(tripId, scope);
  const data = review.data;
  const baseline = new Set((data?.baseline ?? []).map((item) => `${item.kind}:${item.id}`));
  const items = catalog.filter((item) => baseline.has(`${item.kind}:${item.id}`));
  // A record that is excluded but not offered any more (it is not shareable right now) still needs its checkbox.
  const offered = new Set(items.map((item) => `${item.kind}:${item.id}`));
  const held = catalog.filter(
    (item) => isExcluded(scope, item) && !offered.has(`${item.kind}:${item.id}`),
  );
  const groups = groupBy([...items, ...held]);
  const effects = new Map<string, ExcludedRecord>(
    (data?.excluded ?? []).map((entry) => [`${entry.kind}:${entry.id}`, entry]),
  );
  const chosen = (scope.exclude ?? []).length;
  // What applies, not what is stored: a stale entry (a record since deleted) leaves nothing out.
  const leftOut = data ? data.excluded.length : chosen;

  return (
    <section className="grid gap-2.5" aria-label={m.exclusions_heading()}>
      <div className="grid gap-1">
        <h4 className="m-0 text-base">{m.exclusions_heading()}</h4>
        <p className="help m-0">{m.exclusions_intro()}</p>
      </div>
      {review.isPending && (
        <p className="help" role="status">
          {m.exclusions_loading()}
        </p>
      )}
      {review.isError && (
        <p className="help text-travel-review-warning" role="alert">
          {m.exclusions_error()}
        </p>
      )}
      {data && !groups.size && <p className="help">{m.exclusions_none()}</p>}
      {data && chosen > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" role="status">
          <span>
            <strong>{m.exclusions_summary({ count: leftOut })}</strong>
            {!!Object.keys(data.also_hidden).length && (
              <> {m.exclusions_summary_also({ counts: kindCountsText(data.also_hidden) })}</>
            )}
          </span>
          <Button
            className="secondary compact"
            type="button"
            disabled={disabled}
            onClick={() => setScope({ ...scope, exclude: [] })}
          >
            {m.exclusions_show_all()}
          </Button>
        </div>
      )}
      {!!data?.stale && <p className="help">{m.exclusions_stale({ count: data.stale })}</p>}
      <div className="grid gap-2">
        {[...groups].map(([kind, group]) => (
          <ExclusionGroup
            key={kind}
            kind={kind}
            items={group}
            scope={scope}
            setScope={setScope}
            effects={effects}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

function ExclusionGroup({
  kind,
  items,
  scope,
  setScope,
  effects,
  disabled,
}: {
  kind: ShareScopeKind;
  items: CatalogItem[];
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  effects: Map<string, ExcludedRecord>;
  disabled: boolean;
}) {
  useLocale();
  const shown = items.filter((item) => !isExcluded(scope, item)).length;
  // A section that already leaves something out starts open, so the owner sees what is unticked; after that it is theirs.
  const [open, setOpen] = useState(() => shown < items.length);
  return (
    <Collapsible.Root className="scope-group" data-disclosure="" open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="max-sm:flex-wrap max-sm:justify-start max-sm:[&>strong]:basis-3/4 max-sm:[&>span]:basis-full max-sm:[&>span]:pl-6">
        <strong>{GROUP_TITLES[kind]}</strong>
        <span>{m.exclusions_group_line({ p0: shown, p1: items.length })}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-2 px-3.25 pt-0 pb-3.25">
        {items.map((item) => {
          const hidden = isExcluded(scope, item);
          const also = effects.get(`${item.kind}:${item.id}`)?.hides;
          const alsoText = kindCountsText(also);
          return (
            <article
              className="scope-item"
              data-included={hidden ? undefined : ""}
              key={`${item.kind}-${item.id}`}
            >
              <Field className="contents">
                <FieldLabel className="scope-choice">
                  <TravelCheckbox
                    checked={!hidden}
                    disabled={disabled}
                    aria-label={m.exclusions_show_named({ name: item.label })}
                    onCheckedChange={(checked) => setScope(setShown(scope, item, checked))}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                    <em className="text-xs font-medium not-italic text-travel-muted">
                      {" "}
                      {m.exclusions_show_on_link()}
                    </em>
                    {hidden && !!alsoText && (
                      <small className="block text-travel-review-warning">
                        {m.exclusions_also_hides({ counts: alsoText })}
                      </small>
                    )}
                  </span>
                </FieldLabel>
              </Field>
            </article>
          );
        })}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
