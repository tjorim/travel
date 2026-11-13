import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { AlternativeGroup, AlternativeKind } from "../../api-types";
import { comparisonRows, groupTitle, membersOf } from "./model";

/** The group's members side by side, with the exact details only the owner sees. */
export function CompareTable({ kind, group }: { kind: AlternativeKind; group: AlternativeGroup }) {
  useLocale();
  const members = membersOf(group);
  const rows = comparisonRows(
    kind,
    members.map((member) => member.record),
  );
  return (
    <div className="grid gap-2">
      <p className="help m-0">{m.owner_alternatives_compare_help()}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="mb-2 text-left font-bold">{groupTitle(group)}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2">
                <span className="sr-only">{m.owner_compare_detail()}</span>
              </th>
              {members.map((member, index) => (
                <th scope="col" key={member.id} className="p-2 align-bottom">
                  {rows[0]?.values[index]}
                  {member.chosen && (
                    <span className="block font-normal">{m.owner_alternatives_is_chosen()}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row) => (
              <tr key={row.label} className="border-t border-travel-divider">
                <th scope="row" className="p-2 align-top font-semibold">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={members[index].id}
                    className="p-2 align-top wrap-anywhere whitespace-pre-line"
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
