import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource } from "../query/owner-queries";
import { formatDay, type Trip } from "../tracker-model";
import { sectionPath } from "./workspace-sections";

const SHOWN = 5;

/** The next open tasks at a glance. They are edited on the Prepare tab, which this card links to. */
export function OverviewTasks({ trip }: { trip: Trip }) {
  useLocale();
  const tasksQuery = useTripResource(trip.id, "trip-tasks");
  const open = (tasksQuery.data ?? [])
    .filter((task) => !task.completed_at)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  return (
    <section className="travel-card grid content-start gap-4.5 [&_h3]:m-0 [&_p]:m-0">
      <h3>{m.owner_things_to_arrange()}</h3>
      {tasksQuery.isError ? (
        <p role="alert">{m.owner_your_tasks_could_not_be_loaded()}</p>
      ) : open.length ? (
        <div className="saved-records">
          {open.slice(0, SHOWN).map((task) => (
            <div
              className="grid w-full gap-1 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 text-left text-travel-ink shadow-sm [&_span]:text-sm [&_span]:font-medium [&_span]:text-travel-muted"
              key={task.id}
            >
              <strong>{task.title}</strong>
              <span>
                {task.due_date
                  ? m.owner_due({ p0: formatDay(task.due_date) })
                  : m.owner_no_deadline()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        tasksQuery.isSuccess && <p>{m.owner_no_open_tasks()}</p>
      )}
      <Link
        className="secondary action-link w-fit"
        to={sectionPath(trip.id, "prepare")}
        hash="tasks"
      >
        {m.owner_manage_tasks_in_prepare()}
      </Link>
    </section>
  );
}
