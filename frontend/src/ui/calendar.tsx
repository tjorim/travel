import { cn } from "cn";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { enGB } from "react-day-picker/locale/en-GB";
import { nl } from "react-day-picker/locale/nl";
import { useLocale } from "../locale";

const navButton =
  "inline-grid size-11 place-items-center rounded-travel-control bg-transparent p-0 text-travel-ink hover:bg-travel-hover aria-disabled:opacity-40 sm:size-9";

/**
 * shadcn's Calendar on react-day-picker, restyled with Travel tokens. Month and weekday names and the
 * accessible labels follow the interface language, and weeks start on Monday in both.
 */
function Calendar({ className, classNames, ...props }: React.ComponentProps<typeof DayPicker>) {
  const locale = useLocale() === "nl" ? nl : enGB;
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays
      weekStartsOn={1}
      locale={locale}
      data-slot="calendar"
      className={cn("p-1", className)}
      classNames={{
        root: cn("w-fit", defaults.root),
        months: cn("relative", defaults.months),
        month: cn("grid gap-2", defaults.month),
        nav: cn("absolute inset-x-0 top-0 flex items-center justify-between", defaults.nav),
        button_previous: cn(navButton, defaults.button_previous),
        button_next: cn(navButton, defaults.button_next),
        month_caption: cn("flex h-11 items-center justify-center sm:h-9", defaults.month_caption),
        caption_label: cn("text-sm font-extrabold text-travel-ink capitalize", defaults.caption_label),
        month_grid: cn("border-collapse", defaults.month_grid),
        weekday: cn("size-11 p-0 text-xs font-bold text-travel-muted capitalize sm:size-9", defaults.weekday),
        day: cn("p-0 text-center", defaults.day),
        day_button: cn(
          "size-11 rounded-travel-control bg-transparent p-0 font-normal text-travel-ink hover:bg-travel-hover sm:size-9",
          defaults.day_button,
        ),
        selected: cn(
          "[&>button]:bg-primary [&>button]:font-bold [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
          defaults.selected,
        ),
        today: cn("[&>button]:ring-2 [&>button]:ring-travel-forest [&>button]:ring-inset", defaults.today),
        outside: cn("[&>button]:text-travel-muted", defaults.outside),
        disabled: cn("opacity-40", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClass }) => {
          const Icon =
            orientation === "left" ? ChevronLeftIcon : orientation === "right" ? ChevronRightIcon : ChevronDownIcon;
          return <Icon className={cn("size-4", iconClass)} aria-hidden="true" />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
