import { AppearanceControl } from "./appearance";
import { LocaleControl } from "./locale";

/** Language and appearance in one wrapping row, placed at the top of a page shell so it lines up with the page. */
export function Preferences() {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <LocaleControl />
      <AppearanceControl />
    </div>
  );
}
