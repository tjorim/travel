import { useNavigate } from "@tanstack/react-router";

import { SearchSelect } from "../forms/fields";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Field, FieldLabel } from "../ui/field";
import { sectionPath, WORKSPACE_SECTIONS, type TripWorkspaceSection } from "./workspace-sections";

/** Every place the search can jump to, as `tab` or `tab#block`, in the order the workspace shows them. */
function destinations() {
  return WORKSPACE_SECTIONS.flatMap((section) => [
    { value: section.id as string, label: section.label() },
    ...(
      ("parts" in section ? section.parts : []) as readonly { id: string; label: () => string }[]
    ).map((part) => ({
      value: `${section.id}#${part.id}`,
      label: `${section.label()} › ${part.label()}`,
    })),
  ]);
}

/** Type to find a tab or a block inside one, and go straight there; the block is expanded and scrolled into view. */
export function WorkspaceSearch({ tripId }: { tripId: string }) {
  useLocale();
  const navigate = useNavigate();
  function jump(value: string) {
    if (!value) return;
    const [tab, part] = value.split("#") as [TripWorkspaceSection, string | undefined];
    void navigate({
      to: sectionPath(tripId, tab),
      hash: part,
      state: part ? { openSection: { id: part, token: Date.now() } } : undefined,
    });
  }
  return (
    <Field className="flex items-center gap-2.5 max-[679px]:grid max-[679px]:gap-1 min-[680px]:max-w-md">
      <FieldLabel className="shrink-0 text-sm font-bold text-travel-muted">
        {m.owner_jump_to()}
      </FieldLabel>
      <div className="min-w-0 flex-1">
        <SearchSelect ariaLabel={m.owner_jump_to()} value="" onChange={jump}>
          {destinations().map((destination) => (
            <option key={destination.value} value={destination.value}>
              {destination.label}
            </option>
          ))}
        </SearchSelect>
      </div>
    </Field>
  );
}
