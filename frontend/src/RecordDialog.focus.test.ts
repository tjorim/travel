// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { focusReturnTarget, liveElement, rememberPosition } from "./RecordDialog";

afterEach(() => {
  document.body.innerHTML = "";
});

function page() {
  document.body.innerHTML = `
    <section>
      <button id="new">New</button>
      <article id="day"><ul id="list">
        <li><button id="first">First</button></li>
        <li><button id="second">Second</button></li>
      </ul></article>
    </section>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return { get, list: get("list"), day: get("day") };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it("hands focus to the row's neighbour when the deleted row leaves", async () => {
  const { get, list } = page();
  const trigger = get("first");
  const target = focusReturnTarget(trigger, rememberPosition(trigger));
  expect(target).toBe(trigger);
  trigger.focus();
  list.children[0]!.remove();
  await flush();
  expect(document.activeElement).toBe(get("second"));
});

it("also recovers when the whole list of the deleted row is removed", async () => {
  const { get, day } = page();
  const trigger = get("first");
  focusReturnTarget(trigger, rememberPosition(trigger))?.focus();
  expect(document.activeElement).toBe(trigger);
  // The last record of a day goes: its list leaves with it, which a watch on the list itself would not see.
  day.remove();
  await flush();
  expect(document.activeElement).toBe(get("new"));
});

it("leaves focus alone when the user has moved on, and finds a recreated button by its id", async () => {
  const { get, list } = page();
  const trigger = get("first");
  focusReturnTarget(trigger, rememberPosition(trigger));
  get("new").focus();
  list.children[0]!.remove();
  await flush();
  expect(document.activeElement).toBe(get("new"));

  const old = get("second");
  const replacement = old.cloneNode(true) as HTMLElement;
  old.replaceWith(replacement);
  expect(liveElement(old)).toBe(replacement);
});
