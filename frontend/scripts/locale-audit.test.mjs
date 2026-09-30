import { expect, it } from "vitest";
import { catalogueErrors, sourceCandidates, frozenMessageCalls } from "./locale-audit.mjs";

it("rejects missing keys and inputs, including declaration-only plural inputs", () => {
  expect(catalogueErrors({ greeting: "Hello {name}" }, {})).toHaveLength(1);
  expect(catalogueErrors({ greeting: "Hello {name}" }, { greeting: "Hallo {person}" })).toHaveLength(1);
  const plural = (input = "count", match = "countPlural=other") => [
    {
      declarations: [`input ${input}`, "local countPlural = count: plural"],
      selectors: ["countPlural"],
      match: { [match]: "{count} records" },
    },
  ];
  expect(catalogueErrors({ count: plural() }, { count: plural("total") })).toHaveLength(1);
  expect(catalogueErrors({ count: plural() }, { count: plural("count", "countPlural=one") })).toHaveLength(1);
  expect(catalogueErrors({ greeting: "Hello {name}" }, { greeting: "{name}, hallo" })).toEqual([]);
});

it("finds JSX copy, single-word labels, validators, enum prose and template fragments", () => {
  const source = `const labels = { wait: "Even wachten" }; const validate = () => "Geef een naam";
    const text = \`Nog \${count} dagen\`; const view = <><p>Welkom</p><p>{"Hallo"}</p><input aria-label="Naam" placeholder="Zoeken" className="grid gap-2" /></>;`;
  expect(sourceCandidates(source).map((item) => item.text)).toEqual([
    "Even wachten",
    "Geef een naam",
    "Nog",
    "dagen",
    "Welkom",
    "Hallo",
    "Naam",
    "Zoeken",
  ]);
  expect(sourceCandidates('const labels = { title: "Welkom" };').map((item) => item.text)).toEqual(["Welkom"]);
  expect(sourceCandidates('const serverFields = { title: "title" };')).toEqual([]);
  expect(sourceCandidates('const config = { serverFields: { label: "label" } };')).toEqual([]);
  expect(sourceCandidates('const id = "protocol-key";', "source.ts", true)[0].text).toBe("protocol-key");
});

it("rejects module-level translations while allowing deferred functions and getters", () => {
  expect(frozenMessageCalls("const copy = m.settings();")).toEqual([1]);
  expect(frozenMessageCalls("const labels = { title: m.settings() };")).toEqual([1]);
  expect(
    frozenMessageCalls("const labels = { get title() { return m.settings(); } }; const notice = () => m.settings();"),
  ).toEqual([]);
});
