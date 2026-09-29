import { Autocomplete } from "@base-ui/react/autocomplete";
import type { ComponentProps } from "react";

/** A free-text input that offers matching suggestions without restricting the value. */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  ...input
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
} & Omit<ComponentProps<typeof Autocomplete.Input>, "value" | "onChange" | "defaultValue">) {
  return (
    <Autocomplete.Root items={suggestions} value={value} onValueChange={onChange}>
      <Autocomplete.Input {...input} />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="z-50 outline-none" sideOffset={4}>
          <Autocomplete.Popup className="max-h-72 w-(--anchor-width) overflow-y-auto rounded-lg border bg-white p-1 text-travel-ink shadow-lg empty:hidden">
            <Autocomplete.List>
              {(suggestion: string) => (
                <Autocomplete.Item
                  key={suggestion}
                  value={suggestion}
                  className="cursor-pointer rounded-md px-2 py-2 text-sm data-highlighted:bg-travel-paper"
                >
                  {suggestion}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
