#!/usr/bin/env node
// Release helper shared by the tjorim/* repositories. Dependency-free; the file is
// identical in every repo and each repo configures it in release.config.json:
//
//   {
//     "repo": "tjorim/example",            // for CHANGELOG compare links
//     "versionFile": "VERSION",             // default
//     "changelog": "CHANGELOG.md",          // default
//     "targets": [                          // files that must carry the version
//       { "file": "package.json", "pattern": "\"version\": \"([^\"]+)\"" }
//     ]
//   }
//
// Each target `pattern` is a regular expression with exactly one capture group around
// the version. It must match `expect` times (default 1), so a pattern that silently stops
// matching fails loudly instead of leaving a file behind.
//
// Commands:
//   check [--tag vX.Y.Z]           VERSION, every target and the CHANGELOG agree
//   next [--date YYYY-MM-DD]       print the next CalVer (YYYY.M.MICRO)
//   bump [version] [--date D]      write the version everywhere and cut the CHANGELOG
//                                  ([Unreleased] becomes the dated release section)
//   notes [version] [--max-chars N]  print one version's CHANGELOG body (for release notes)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_RE = /^(\d{4})\.([1-9]|1[0-2])\.([1-9]\d*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNRELEASED_RE = /^## \[Unreleased\]\s*$/;
const REF_RE = /^\[[^\]]+\]:\s+\S+/;
const DEFAULT_MAX_NOTES_CHARS = 120_000; // GitHub rejects release bodies over 125,000

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sectionRe = (version) =>
  new RegExp(`^## \\[${escapeRe(version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`);

export function parseVersion(version) {
  const match = VERSION_RE.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** CalVer is YYYY.M.MICRO: MICRO counts releases within a month and restarts at 1. */
export function nextVersion(current, today) {
  const [year, month] = today.split("-").map(Number);
  const parsed = parseVersion(current);
  if (parsed && parsed[0] === year && parsed[1] === month)
    return `${year}.${month}.${parsed[2] + 1}`;
  return `${year}.${month}.1`;
}

export function readConfig(root) {
  const config = JSON.parse(readFileSync(join(root, "release.config.json"), "utf8"));
  return { versionFile: "VERSION", changelog: "CHANGELOG.md", targets: [], ...config };
}

const readVersion = (root, config) => readFileSync(join(root, config.versionFile), "utf8").trim();

function scanTarget(root, target) {
  const text = readFileSync(join(root, target.file), "utf8");
  const matches = [...text.matchAll(new RegExp(target.pattern, "gd"))];
  return { text, matches };
}

/** First line index after `start` that ends the section: next heading, rule or link reference. */
function sectionEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || lines[i] === "---" || REF_RE.test(lines[i])) return i;
  }
  return lines.length;
}

export function check(root, { tag } = {}) {
  const config = readConfig(root);
  const errors = [];
  const version = readVersion(root, config);

  if (!parseVersion(version)) {
    return [`${config.versionFile}: "${version}" is not CalVer (YYYY.M.MICRO, e.g. 2026.11.1)`];
  }
  if (tag !== undefined && tag !== `v${version}`) {
    errors.push(
      `tag "${tag}" does not match ${config.versionFile} "${version}" (expected v${version})`,
    );
  }

  for (const target of config.targets) {
    const expected = target.expect ?? 1;
    const { matches } = scanTarget(root, target);
    if (matches.length !== expected) {
      errors.push(
        `${target.file}: expected ${expected} match(es) of /${target.pattern}/, found ${matches.length}`,
      );
      continue;
    }
    for (const match of matches) {
      if (match[1] !== version) {
        errors.push(
          `${target.file}: version "${match[1]}" does not match ${config.versionFile} "${version}"`,
        );
      }
    }
  }

  const lines = readFileSync(join(root, config.changelog), "utf8").split("\n");
  if (!lines.some((l) => UNRELEASED_RE.test(l)))
    errors.push(`${config.changelog}: missing "## [Unreleased]"`);
  if (!lines.some((l) => sectionRe(version).test(l))) {
    errors.push(`${config.changelog}: missing "## [${version}] - YYYY-MM-DD"`);
  }
  if (!lines.some((l) => l.startsWith(`[${version}]:`))) {
    errors.push(`${config.changelog}: missing link reference "[${version}]: <url>"`);
  }
  if (!lines.some((l) => l.startsWith("[Unreleased]:"))) {
    errors.push(`${config.changelog}: missing link reference "[Unreleased]: <url>"`);
  }
  return errors;
}

export function bump(root, { version, date, allowEmpty = false } = {}) {
  const config = readConfig(root);
  const current = readVersion(root, config);
  const today = date ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(today)) throw new Error(`date "${today}" is not YYYY-MM-DD`);
  const next = version ?? nextVersion(current, today);
  if (!parseVersion(next)) throw new Error(`"${next}" is not CalVer (YYYY.M.MICRO)`);
  if (parseVersion(current) && compareVersions(next, current) <= 0) {
    throw new Error(`${next} is not newer than the current version ${current}`);
  }

  // Do every read and validation before writing anything.
  const edits = config.targets.map((target) => {
    const expected = target.expect ?? 1;
    const { text, matches } = scanTarget(root, target);
    if (matches.length !== expected) {
      throw new Error(
        `${target.file}: expected ${expected} match(es) of /${target.pattern}/, found ${matches.length}`,
      );
    }
    let out = text;
    for (const match of [...matches].reverse()) {
      const [from, to] = match.indices[1];
      out = out.slice(0, from) + next + out.slice(to);
    }
    return { file: target.file, out };
  });

  const lines = readFileSync(join(root, config.changelog), "utf8").split("\n");
  const unreleased = lines.findIndex((l) => UNRELEASED_RE.test(l));
  if (unreleased < 0) throw new Error(`${config.changelog}: missing "## [Unreleased]"`);
  const body = lines
    .slice(unreleased + 1, sectionEnd(lines, unreleased))
    .join("\n")
    .trim();
  if (!body && !allowEmpty)
    throw new Error("[Unreleased] is empty — nothing to release (--allow-empty overrides)");
  lines.splice(unreleased + 1, 0, "", `## [${next}] - ${today}`);

  const base = config.repo ? `https://github.com/${config.repo}` : null;
  const unreleasedRef = lines.findIndex((l) => l.startsWith("[Unreleased]:"));
  if (base) {
    const refs = [
      `[Unreleased]: ${base}/compare/v${next}...HEAD`,
      `[${next}]: ${base}/compare/v${current}...v${next}`,
    ];
    if (unreleasedRef >= 0) lines.splice(unreleasedRef, 1, ...refs);
    else lines.push(...(lines.at(-1) === "" ? [] : [""]), ...refs, "");
  }

  for (const { file, out } of edits) writeFileSync(join(root, file), out);
  writeFileSync(join(root, config.versionFile), `${next}\n`);
  writeFileSync(join(root, config.changelog), lines.join("\n"));
  return { from: current, to: next, date: today };
}

export function notes(root, version, { maxChars = DEFAULT_MAX_NOTES_CHARS } = {}) {
  const config = readConfig(root);
  const v = version ?? readVersion(root, config);
  const lines = readFileSync(join(root, config.changelog), "utf8").split("\n");
  const start = lines.findIndex((l) => sectionRe(v).test(l));
  if (start < 0) throw new Error(`${config.changelog}: no section for ${v}`);
  const body = lines
    .slice(start + 1, sectionEnd(lines, start))
    .join("\n")
    .trim();
  if (body.length <= maxChars) return body;
  const cut = body.slice(0, maxChars);
  const boundary = cut.lastIndexOf("\n\n");
  return `${cut.slice(0, boundary > 0 ? boundary : maxChars)}\n\n_Notes truncated — see ${config.changelog} for the full list._`;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-empty") flags.allowEmpty = true;
    else if (arg.startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { flags, positional };
}

function main(argv) {
  const root = resolve(
    process.env.RELEASE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const fail = (message) => {
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `error: ${message}`);
    process.exitCode = 1;
  };
  try {
    if (command === "check") {
      const errors = check(root, { tag: flags.tag });
      if (errors.length) errors.forEach(fail);
      else console.log(`release metadata consistent (${readVersion(root, readConfig(root))})`);
    } else if (command === "next") {
      const config = readConfig(root);
      console.log(
        nextVersion(readVersion(root, config), flags.date ?? new Date().toISOString().slice(0, 10)),
      );
    } else if (command === "bump") {
      const result = bump(root, {
        version: positional[0],
        date: flags.date,
        allowEmpty: flags.allowEmpty,
      });
      console.log(
        `bumped ${result.from} -> ${result.to} (${result.date}); review the diff, then run check`,
      );
    } else if (command === "notes") {
      const maxChars = flags["max-chars"] ? Number(flags["max-chars"]) : undefined;
      console.log(notes(root, positional[0], { maxChars }));
    } else {
      console.error(
        "usage: release.mjs check [--tag vX] | next [--date D] | bump [version] [--date D] [--allow-empty] | notes [version] [--max-chars N]",
      );
      process.exitCode = 2;
    }
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2));
