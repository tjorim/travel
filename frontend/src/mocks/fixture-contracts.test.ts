import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseSync, Visitor } from "oxc-parser";
import { expect, it } from "vitest";

/** A checked payload or a concrete explanation must be visible at the response boundary. */
export function uncheckedFixtures(file: string, source: string): number[] {
  const unchecked: number[] = [];
  const parsed = parseSync(file, source);
  const exception = (text: string) =>
    /\/\* (?:Fixture exception:|Deliberately malformed:)[\s\S]+?\*\//.test(text);
  const fail = (start: number) => unchecked.push(source.slice(0, start).split("\n").length);
  new Visitor({
    CallExpression(node) {
      const callee = source.slice(node.callee.start, node.callee.end);
      const text = source.slice(node.callee.end, node.end);
      if (exception(text)) return;
      const shared = /(?:fake-api|response"|mock-api")/.test(source);
      if (
        ["HttpResponse.json", "jsonResponse", "json"].includes(callee) ||
        (shared && (/\.(?:collection|value)$/.test(callee) || /^api\.(?:on|push)$/.test(callee)))
      ) {
        if (!node.typeArguments) fail(node.start);
        else {
          const types = source.slice(node.typeArguments.start, node.typeArguments.end);
          if (/\b(?:any|unknown)\b/.test(types) || /as (?:never|unknown)/.test(text))
            fail(node.start);
        }
      }
      if (callee === "fixtureResponse") fail(node.start);
      if (callee.endsWith(".fulfill")) {
        const options = node.arguments[0];
        if (options?.type !== "ObjectExpression") return;
        const json = options.properties.find(
          (prop) =>
            prop.type === "Property" && prop.key.type === "Identifier" && prop.key.name === "json",
        );
        if (!json || json.type !== "Property") {
          const body = options.properties.find(
            (prop) =>
              prop.type === "Property" &&
              prop.key.type === "Identifier" &&
              prop.key.name === "body",
          );
          if (body?.type === "Property") {
            const serialized = source.slice(body.value.start, body.value.end);
            // JSON serializers inside generic NoInfer helpers are covered by negative compile checks.
            const helper =
              /const json = <T = never>/.test(source) && /JSON.stringify\(body\)/.test(serialized);
            if (
              serialized.includes("JSON.stringify") &&
              !helper &&
              !serialized.includes("satisfies Api.")
            )
              fail(node.start);
          }
          return;
        }
        let value = json.value;
        while (value.type === "ParenthesizedExpression") value = value.expression;
        if (value.type !== "TSSatisfiesExpression") fail(node.start);
      }
    },
  }).visit(parsed.program);
  return unchecked;
}

it("keeps MSW, stateful test helpers and browser success responses schema-checked", () => {
  const unchecked: string[] = [];
  for (const directory of ["src", "e2e"]) {
    for (const entry of readdirSync(resolve(directory), { recursive: true })) {
      const file = resolve(directory, String(entry));
      if (
        !/\.(?:test|spec)\.tsx?$/.test(file) &&
        !file.endsWith("/e2e/mock-api.ts") &&
        !file.endsWith("/e2e/agenda-records.ts")
      )
        continue;
      if (file.endsWith("/fixture-contracts.test.ts")) continue;
      for (const line of uncheckedFixtures(file, readFileSync(file, "utf8")))
        unchecked.push(`${file}:${line}`);
    }
  }
  expect(unchecked).toEqual([]);
});

it("rejects inferred or erased success fixtures while allowing explicit schema checks and reasoned exceptions", () => {
  expect(
    uncheckedFixtures(
      "fixture.ts",
      `
    HttpResponse.json({ renamed: true });
    HttpResponse.json<unknown>({ renamed: true });
    route.fulfill({ json: { renamed: true } });
    HttpResponse.json<Api.TripResponse>(record as never);
  `,
    ),
  ).toHaveLength(4);
  expect(
    uncheckedFixtures(
      "fixture.ts",
      `
    HttpResponse.json<Api.TripResponse>(trip);
    route.fulfill({ json: trip satisfies Api.TripResponse });
    HttpResponse.json(/* Fixture exception: Malformed success tests the compatibility fallback. */ {});
  `,
    ),
  ).toEqual([]);
});
