import { Combobox } from "@base-ui/react/combobox";
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";

export type SearchSelectOption = { value: string; label: ReactNode; isDisabled?: boolean };
export type SearchSelectGroup = { label: string; options: SearchSelectOption[] };
type Choice = SearchSelectOption | SearchSelectGroup;
type DisplayGroup = { value: string; label: string; items: SearchSelectOption[] };

function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children);
  return "";
}

function optionsFromChildren(children: ReactNode): Choice[] {
  const choices: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === "option")
      choices.push({
        value: String(child.props.value ?? ""),
        label: child.props.children,
        isDisabled: child.props.disabled,
      });
    else if (child.type === "optgroup")
      choices.push({
        label: child.props.label ?? "",
        options: optionsFromChildren(child.props.children).filter(
          (item): item is SearchSelectOption => "value" in item,
        ),
      });
  });
  return choices;
}

function groupChoices(choices: Choice[]): DisplayGroup[] {
  const groups: DisplayGroup[] = [];
  choices.forEach((choice, index) => {
    if ("options" in choice) groups.push({ value: `group-${index}`, label: choice.label, items: choice.options });
    else if (groups.at(-1)?.label === "") groups.at(-1)!.items.push(choice);
    else groups.push({ value: `group-${index}`, label: "", items: [choice] });
  });
  return groups;
}

function findOption(choices: Choice[], value: string): SearchSelectOption | null {
  for (const choice of choices) {
    if ("options" in choice) {
      const found = choice.options.find((item) => item.value === value);
      if (found) return found;
    } else if (choice.value === value) return choice;
  }
  return null;
}

function SearchCombobox({
  ariaLabel,
  value,
  onChange,
  onBlur,
  isDisabled,
  choices,
  selectedOption,
  onQueryChange,
  onClose,
  remote = false,
  name,
}: {
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  isDisabled?: boolean;
  choices: Choice[];
  selectedOption?: SearchSelectOption | null;
  onQueryChange?: (query: string) => void;
  onClose?: () => void;
  remote?: boolean;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedOption ?? findOption(choices, value) ?? (value ? { value, label: value } : null);
  const visible = groupChoices(choices);
  const known =
    selected && !findOption(choices, selected.value)
      ? [{ value: "selected", label: "", items: [selected] }, ...visible]
      : visible;
  return (
    <Combobox.Root
      open={open}
      items={known}
      filteredItems={remote ? visible : undefined}
      filter={remote ? null : undefined}
      value={selected}
      isItemEqualToValue={(item, chosen) => item.value === chosen.value}
      itemToStringLabel={(item) => labelText(item.label)}
      itemToStringValue={(item) => item.value}
      onValueChange={(next) => onChange(next?.value ?? "")}
      onInputValueChange={(query, details) => {
        if (
          (details.reason === "input-change" || details.reason === "input-clear") &&
          query !== labelText(selected?.label)
        ) {
          setOpen(true);
          onQueryChange?.(query);
        }
      }}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) onClose?.();
      }}
      disabled={isDisabled}
      name={name}
    >
      <Combobox.InputGroup className="relative flex w-full items-stretch">
        <Combobox.Input
          aria-label={ariaLabel}
          // An explicit accessible name wins over the surrounding Field label.
          render={(props) => <input {...props} aria-labelledby={ariaLabel ? undefined : props["aria-labelledby"]} />}
          onBlur={onBlur}
          className="min-w-0 flex-1 rounded-r-none! border-r-0!"
        />
        <Combobox.Trigger
          aria-labelledby=""
          aria-label={`${ariaLabel ?? "Keuze"} opties tonen`}
          className="shrink-0 rounded-l-none! border! border-travel-muted! bg-white! px-3! text-travel-ink!"
        >
          <span aria-hidden="true">▾</span>
        </Combobox.Trigger>
        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-white p-1 text-travel-ink shadow-lg">
            <Combobox.Empty className="p-2 text-sm">Geen resultaten</Combobox.Empty>
            <Combobox.List>
              {(group: DisplayGroup) => (
                <Combobox.Group key={group.value} items={group.items}>
                  {group.label && (
                    <Combobox.GroupLabel className="px-2 py-1 text-xs font-semibold text-travel-muted">
                      {group.label}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(option: SearchSelectOption) => (
                      <Combobox.Item
                        key={option.value}
                        value={option}
                        disabled={option.isDisabled}
                        className="cursor-pointer rounded-md px-2 py-2 text-sm data-highlighted:bg-travel-paper data-selected:bg-travel-forest data-selected:text-white"
                      >
                        {option.label}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </div>
        )}
      </Combobox.InputGroup>
    </Combobox.Root>
  );
}

export function SearchSelect({
  ariaLabel,
  value,
  onChange,
  onBlur,
  isDisabled,
  children,
  name,
}: {
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  isDisabled?: boolean;
  children: ReactNode;
  name?: string;
}) {
  return (
    <SearchCombobox
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      isDisabled={isDisabled}
      choices={optionsFromChildren(children)}
      name={name}
    />
  );
}

/** A bounded server search. The selected option stays visible outside the result window. */
export function AsyncSearchSelect({
  ariaLabel,
  value,
  selectedOption,
  defaultOptions = [],
  onChange,
  loadOptions,
  isDisabled,
}: {
  ariaLabel: string;
  value: string;
  selectedOption?: SearchSelectOption | null;
  defaultOptions?: Choice[];
  onChange: (value: string) => void;
  loadOptions: (query: string) => Promise<Choice[]>;
  isDisabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Choice[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchId = useRef(0);
  useEffect(
    () => () => {
      searchId.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function updateQuery(next: string) {
    setQuery(next);
    searchId.current++;
    const current = searchId.current;
    if (timer.current) clearTimeout(timer.current);
    if (!next) return;
    timer.current = setTimeout(() => {
      void loadOptions(next)
        .then((options) => {
          if (current === searchId.current) setResults(options);
        })
        .catch(() => {
          if (current === searchId.current) setResults([]);
        });
    }, 250);
  }
  return (
    <SearchCombobox
      ariaLabel={ariaLabel}
      value={value}
      selectedOption={selectedOption}
      choices={query ? results : defaultOptions}
      onChange={(next) => {
        updateQuery("");
        onChange(next);
      }}
      onQueryChange={updateQuery}
      onClose={() => updateQuery("")}
      remote
      isDisabled={isDisabled}
    />
  );
}
