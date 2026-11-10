import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bump, check, compareVersions, nextVersion, notes } from "./release.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- Something new

## [2026.11.1] - 2026-11-10

### Added

- First release

[Unreleased]: https://github.com/tjorim/example/compare/v2026.11.1...HEAD
[2026.11.1]: https://github.com/tjorim/example/compare/v2026.9.3...v2026.11.1
`;

let root;
const write = (file, text) => writeFileSync(join(root, file), text);
const read = (file) => readFileSync(join(root, file), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "release-test-"));
  write("VERSION", "2026.11.1\n");
  write("package.json", '{\n  "name": "x",\n  "version": "2026.11.1"\n}\n');
  write("app.py", 'app = App(version="2026.11.1")\nother = Thing(version="9.9.9")\n');
  write("CHANGELOG.md", CHANGELOG);
  write(
    "release.config.json",
    JSON.stringify({
      repo: "tjorim/example",
      targets: [
        { file: "package.json", pattern: '"version": "([^"]+)"' },
        { file: "app.py", pattern: 'App\\(version="([^"]+)"' },
      ],
    }),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("versions", () => {
  it("counts MICRO within a month and restarts it in a new month", () => {
    assert.equal(nextVersion("2026.11.1", "2026-11-20"), "2026.11.2");
    assert.equal(nextVersion("2026.11.2", "2026-12-01"), "2026.12.1");
    assert.equal(nextVersion("2026.12.4", "2027-01-03"), "2027.1.1");
  });

  it("compares numerically, not lexically", () => {
    assert.equal(compareVersions("2026.9.3", "2026.11.1"), -1);
    assert.equal(compareVersions("2026.11.10", "2026.11.9"), 1);
    assert.equal(compareVersions("2026.11.1", "2026.11.1"), 0);
  });
});

describe("check", () => {
  it("passes on consistent metadata", () => {
    assert.deepEqual(check(root), []);
    assert.deepEqual(check(root, { tag: "v2026.11.1" }), []);
  });

  it("rejects a tag that does not match VERSION", () => {
    assert.match(check(root, { tag: "v2026.11.2" })[0], /does not match/);
  });

  it("rejects a malformed VERSION", () => {
    write("VERSION", "1.2.3\n");
    assert.match(check(root)[0], /not CalVer/);
    write("VERSION", "2026.13.1\n");
    assert.match(check(root)[0], /not CalVer/);
  });

  it("reports a drifted target", () => {
    write("package.json", '{ "version": "2026.9.3" }\n');
    assert.deepEqual(check(root), [
      'package.json: version "2026.9.3" does not match VERSION "2026.11.1"',
    ]);
  });

  it("reports a pattern that stopped matching", () => {
    write("app.py", "app = App()\n");
    assert.match(check(root)[0], /expected 1 match\(es\).*found 0/);
  });

  it("requires the changelog section and link references", () => {
    write("VERSION", "2026.11.2\n");
    write("package.json", '{ "version": "2026.11.2" }\n');
    write("app.py", 'App(version="2026.11.2")\n');
    const errors = check(root);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /missing "## \[2026\.11\.2\]/);
    assert.match(errors[1], /missing link reference "\[2026\.11\.2\]/);
  });
});

describe("bump", () => {
  it("updates every file, cuts the changelog and leaves a consistent repo", () => {
    const result = bump(root, { date: "2026-11-20" });
    assert.deepEqual(result, { from: "2026.11.1", to: "2026.11.2", date: "2026-11-20" });
    assert.equal(read("VERSION"), "2026.11.2\n");
    assert.match(read("package.json"), /"version": "2026\.11\.2"/);
    assert.match(read("app.py"), /App\(version="2026\.11\.2"\)/);
    assert.match(read("app.py"), /Thing\(version="9\.9\.9"\)/); // untouched
    const changelog = read("CHANGELOG.md");
    assert.match(
      changelog,
      /## \[Unreleased\]\n\n## \[2026\.11\.2\] - 2026-11-20\n\n### Fixed\n\n- Something new/,
    );
    assert.match(changelog, /\[Unreleased\]: .*\/compare\/v2026\.11\.2\.\.\.HEAD/);
    assert.match(changelog, /\[2026\.11\.2\]: .*\/compare\/v2026\.11\.1\.\.\.v2026\.11\.2/);
    assert.deepEqual(check(root), []);
  });

  it("accepts an explicit version and rejects one that is not newer", () => {
    assert.equal(bump(root, { version: "2026.12.1", date: "2026-12-01" }).to, "2026.12.1");
    assert.throws(() => bump(root, { version: "2026.11.9", date: "2026-12-01" }), /not newer/);
  });

  it("refuses to cut an empty release unless asked", () => {
    bump(root, { date: "2026-11-20" });
    assert.throws(() => bump(root, { date: "2026-11-21" }), /\[Unreleased\] is empty/);
    assert.equal(bump(root, { date: "2026-11-21", allowEmpty: true }).to, "2026.11.3");
  });

  it("writes nothing when a target does not match", () => {
    write("app.py", "app = App()\n");
    assert.throws(() => bump(root, { date: "2026-11-20" }), /found 0/);
    assert.equal(read("VERSION"), "2026.11.1\n");
    assert.match(read("package.json"), /2026\.11\.1/);
    assert.equal(read("CHANGELOG.md"), CHANGELOG);
  });
});

describe("notes", () => {
  it("returns one section without the next heading or link references", () => {
    assert.equal(notes(root, "2026.11.1"), "### Added\n\n- First release");
    assert.equal(notes(root), "### Added\n\n- First release");
  });

  it("fails for a version without a section", () => {
    assert.throws(() => notes(root, "2026.11.9"), /no section for 2026\.11\.9/);
  });

  it("truncates oversized notes at a paragraph boundary and says so", () => {
    const bullets = Array.from({ length: 50 }, (_, i) => `- Entry ${i} ${"x".repeat(40)}`).join(
      "\n\n",
    );
    write("CHANGELOG.md", `## [Unreleased]\n\n## [2026.11.1] - 2026-11-10\n\n${bullets}\n`);
    const out = notes(root, "2026.11.1", { maxChars: 500 });
    assert.ok(out.length < 600);
    assert.match(out, /_Notes truncated — see CHANGELOG\.md/);
    assert.doesNotMatch(out, /Entry 4[0-9]/);
  });
});
