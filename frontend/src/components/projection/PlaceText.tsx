import type { ProjectionArea } from "@/api-types";
import { LocalName } from "@/components/LocalName";
import { country, text } from "./projectionFormatting";
import { useTextLang } from "./visitor-language";

/** An area's line: its authored name in the language it is written in, then the region and the country's name. */
export function PlaceText({
  area,
  transport = false,
}: {
  area: ProjectionArea;
  transport?: boolean;
}) {
  const lang = useTextLang();
  const label = text(area.label);
  const rest = [text(area.region), country(area)].filter(Boolean).join(" · ");
  // A transport end without a name or region is just the country.
  if (transport && !label && !text(area.region)) return <>{country(area)}</>;
  return (
    <>
      {label && <span lang={lang(area.label_lang)}>{label}</span>}
      {label && text(area.local_name) && (
        <>
          {" ("}
          <LocalName name={text(area.local_name) ?? ""} className="text-inherit" />
          {")"}
        </>
      )}
      {label && rest && " · "}
      {rest}
    </>
  );
}
