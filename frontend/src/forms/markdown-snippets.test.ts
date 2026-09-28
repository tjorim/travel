import { expect, it } from "vitest";

import { applyMarkdownSnippet } from "./markdown-snippets";

const selected = (edit: { value: string; selectionStart: number; selectionEnd: number }) =>
  edit.value.slice(edit.selectionStart, edit.selectionEnd);

it("wraps the selection in bold or italic and keeps it selected", () => {
  const bold = applyMarkdownSnippet("Night market", 0, 5, "bold");
  expect(bold.value).toBe("**Night** market");
  expect(selected(bold)).toBe("Night");
  const italic = applyMarkdownSnippet("Night market", 6, 12, "italic");
  expect(italic.value).toBe("Night *market*");
  expect(selected(italic)).toBe("market");
});

it("inserts a selected placeholder without a selection", () => {
  const edit = applyMarkdownSnippet("See ", 4, 4, "bold");
  expect(edit.value).toBe("See **vet**");
  expect(selected(edit)).toBe("vet");
});

it("prefixes every selected line and leaves blank lines alone", () => {
  const edit = applyMarkdownSnippet("Intro\nbook train\n\npassport\nOutro", 8, 25, "tasks");
  expect(edit.value).toBe("Intro\n- [ ] book train\n\n- [ ] passport\nOutro");
  expect(selected(edit)).toBe("- [ ] book train\n\n- [ ] passport");
});

it("prefixes the cursor's line for a heading or a list", () => {
  expect(applyMarkdownSnippet("One\nDay two\nThree", 6, 6, "heading").value).toBe("One\n## Day two\nThree");
  expect(applyMarkdownSnippet("tea", 0, 0, "list").value).toBe("- tea");
  // A selection that ends just after a line break stays on its own lines.
  expect(applyMarkdownSnippet("a\nb", 0, 2, "list").value).toBe("- a\nb");
});

it("starts an empty line with a selected placeholder", () => {
  const edit = applyMarkdownSnippet("Start\n", 6, 6, "list");
  expect(edit.value).toBe("Start\n- Item");
  expect(selected(edit)).toBe("Item");
  expect(applyMarkdownSnippet("\nx", 0, 0, "heading").value).toBe("## Kop\nx");
});

it("turns a selection into link text and selects the address to fill in", () => {
  const edit = applyMarkdownSnippet("Book the hotel", 9, 14, "link");
  expect(edit.value).toBe("Book the [hotel](https://)");
  expect(selected(edit)).toBe("https://");
});

it("turns a selected address into the link target and selects the text", () => {
  const edit = applyMarkdownSnippet("Site: https://example.com", 6, 25, "link");
  expect(edit.value).toBe("Site: [linktekst](https://example.com)");
  expect(selected(edit)).toBe("linktekst");
  expect(selected(applyMarkdownSnippet("", 0, 0, "link"))).toBe("linktekst");
});

it("clamps a selection outside the text", () => {
  expect(applyMarkdownSnippet("ab", 5, 9, "italic").value).toBe("ab*cursief*");
});
