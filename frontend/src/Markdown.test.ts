import { expect, it } from "vitest";
import { fitHeadings } from "./Markdown";

it("fits authored headings one level below the heading they sit under", () => {
  const html = "<h5>One</h5><p>x</p><h6>Two</h6>";
  expect(fitHeadings(html, 3)).toBe("<h4>One</h4><p>x</p><h5>Two</h5>");
  expect(fitHeadings(html, 2)).toBe("<h3>One</h3><p>x</p><h4>Two</h4>");
  // Levels never leave h1-h6, and text without headings is untouched.
  expect(fitHeadings("<h4>A</h4><h6>B</h6>", 5)).toBe("<h6>A</h6><h6>B</h6>");
  expect(fitHeadings("<p>none</p>", 3)).toBe("<p>none</p>");
});
