import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Markdown } from "../../Markdown";
import { formatDay, type Trip, type TripTask } from "../../tracker-model";
import { RecordHeading, Section, timestamp } from "./shared";
import { DetailList } from "./DetailList";

export function TasksBlock({ trip, tasks }: { trip: Trip; tasks: TripTask[] }) {
  useLocale();
  return (
    <Section id="tasks" title={m.owner_tasks()}>
      <DetailList empty={tasks.length === 0} message={m.owner_no_tasks_captured()}>
        {tasks
          .slice()
          .sort(
            (a, b) =>
              (a.completed_at ? 1 : 0) - (b.completed_at ? 1 : 0) ||
              (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
          )
          .map((task) => (
            <article key={task.id}>
              <RecordHeading tripId={trip.id} kind="task" id={task.id}>
                {task.title}
              </RecordHeading>
              <p>
                {task.completed_at
                  ? m.owner_completed_on({ p0: timestamp(task.completed_at) })
                  : task.due_date
                    ? m.owner_due({ p0: formatDay(task.due_date) })
                    : m.owner_no_deadline()}
              </p>
              {task.remind_at && (
                <p>
                  {m.owner_reminder()} {timestamp(task.remind_at)}
                </p>
              )}
              <Markdown html={task.notes_html} text={task.notes} />
              {task.links.map((link) => (
                <p key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                </p>
              ))}
            </article>
          ))}
      </DetailList>
    </Section>
  );
}
