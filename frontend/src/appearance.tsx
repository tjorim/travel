import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
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
  useLocale();
  const value = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.appearance ?? "auto") as Appearance,
  );
  return (
    <div className="mx-auto w-travel-index-shell pt-4">
      <ChoiceGroup
        label={m.appearance()}
        value={value}
        choices={[
          { value: "light", label: m.light() },
          { value: "dark", label: m.dark() },
          { value: "auto", label: m.auto() },
        ]}
        onChange={(next) => window.dispatchEvent(new CustomEvent("travel-appearance-set", { detail: next }))}
      />
    </div>
  );
}
