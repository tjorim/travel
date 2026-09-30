import { useSyncExternalStore } from "react";
import { ChoiceGroup } from "./ui/ChoiceGroup";

export type Appearance = "light" | "dark" | "auto";
const subscribe = (notify: () => void) => {
  window.addEventListener("travel-appearance-change", notify);
  return () => window.removeEventListener("travel-appearance-change", notify);
};
export function useTheme() {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? "light");
}
export function themeColor(token: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-travel-${token}`).trim();
}
export function AppearanceControl() {
  const value = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.appearance ?? "auto") as Appearance,
  );
  return (
    <div className="mx-auto w-travel-index-shell pt-4">
      <ChoiceGroup
        label="Weergave"
        value={value}
        choices={[
          { value: "light", label: "Licht" },
          { value: "dark", label: "Donker" },
          { value: "auto", label: "Automatisch" },
        ]}
        onChange={(next) => window.dispatchEvent(new CustomEvent("travel-appearance-set", { detail: next }))}
      />
    </div>
  );
}
