/** Marks a date or time input whose text is not a date or time yet, so the form must not be submitted. */
export const UNREADABLE_ENTRY = "data-unreadable";

/**
 * Stops a submit while a date or time field holds text that cannot be read. The field keeps its last valid value in
 * the form, so the form's own validators cannot see the problem: this focuses the field, which also shows its error.
 * Returns whether the submit was stopped.
 */
export function blockUnreadableEntries(form: HTMLFormElement | null): boolean {
  const entry = form?.querySelector<HTMLElement>(`[${UNREADABLE_ENTRY}]`);
  if (!entry) return false;
  // Leaving the field is what makes it show its error, so the focus passes through a blur even if it was elsewhere.
  entry.focus();
  // Leaving the field is what makes it show its error, so make sure it was entered first.
  entry.focus();
  entry.blur();
  entry.focus();
  return true;
}
