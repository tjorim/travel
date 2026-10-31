import { Button } from "@/ui/button";
import { useId } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

type Choice<T extends string> = { value: T; label: string };

/** A single-choice control for short, frequently changed views. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="min-w-0 max-w-full space-y-1">
      <span id={labelId} className="block text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        value={value}
        aria-labelledby={labelId}
        onValueChange={(next) => onChange(next as T)}
        className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border p-1"
      >
        {choices.map((choice) => (
          <Radio.Root
            key={choice.value}
            value={choice.value}
            aria-label={choice.label}
            nativeButton
            render={<Button type="button" />}
            className="min-h-11 rounded-lg bg-travel-paper! px-3 text-sm font-medium text-travel-ink! data-checked:bg-travel-forest! data-checked:text-travel-on-action!"
          >
            {choice.label}
          </Radio.Root>
        ))}
      </RadioGroup>
    </div>
  );
}
