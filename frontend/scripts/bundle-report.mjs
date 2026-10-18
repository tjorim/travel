// Reports the production JS the owner PWA fetches at startup, from a finished `pnpm build` (dist/).
//
// "Initial" is the static import closure of an HTML entry: its module scripts, its modulepreload links and every
// chunk those import statically. Dynamic `import()` targets are lazy and counted only in the total.
//
//   node scripts/bundle-report.mjs            print the report
//   node scripts/bundle-report.mjs --check    also fail when an entry exceeds its budget in bundle-budget.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
const read = (file) => fs.readFileSync(path.join(assets, file));
const sizes = (files) => {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const bytes = read(file);
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
  }
  return { raw, gzip, count: files.size };
};

const staticImports = (file) => {
  const source = read(file).toString("utf8");
  // `import"./x.js"`, `import{a}from"./x.js"`, `export{a}from"./x.js"`. `import("./x.js")` is dynamic and skipped.
  const pattern = /(?:\bimport|\bexport)\s*(?:[\w*${},\s]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
};

function closure(entries) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !fs.existsSync(path.join(assets, file))) return;
    seen.add(file);
    staticImports(file).forEach(visit);
  };
  entries.forEach(visit);
  return seen;
}

function entryScripts(html) {
  const text = fs.readFileSync(path.join(dist, html), "utf8");
  return [...text.matchAll(/(?:src|href)="\/admin\/assets\/([^"]+\.js)"/g)].map(
    (match) => match[1],
  );
}

const all = fs.readdirSync(assets).filter((file) => file.endsWith(".js"));
const entries = {
  admin: "index.html",
  landing: "landing.html",
  public: "public.html",
  share: "share.html",
};
const report = {};
for (const [name, html] of Object.entries(entries)) {
  const files = closure(entryScripts(html));
  report[name] = { ...sizes(files), files: [...files].sort() };
}
const total = sizes(new Set(all));

console.log("Initial static JS per entry (raw / gzip):");
for (const [name, entry] of Object.entries(report))
  console.log(`  ${name.padEnd(8)} ${entry.count} files  ${kb(entry.raw)} / ${kb(entry.gzip)}`);
console.log(`Total JS in dist/assets: ${total.count} files  ${kb(total.raw)} / ${kb(total.gzip)}`);

const lazyAdmin = all.filter((file) => !report.admin.files.includes(file));
console.log(`\nAdmin chunks fetched on demand (${lazyAdmin.length}), largest first:`);
for (const file of lazyAdmin
  .map((file) => ({ file, size: read(file).length }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 12))
  console.log(`  ${file.file.padEnd(48)} ${kb(file.size)}`);

if (process.argv.includes("--check")) {
  const budget = JSON.parse(fs.readFileSync(path.join(root, "bundle-budget.json"), "utf8"));
  const failures = [];
  for (const [name, limits] of Object.entries(budget.entries)) {
    const actual = report[name];
    if (actual.raw > limits.raw) failures.push(`${name} raw ${kb(actual.raw)} > ${kb(limits.raw)}`);
    if (actual.gzip > limits.gzip)
      failures.push(`${name} gzip ${kb(actual.gzip)} > ${kb(limits.gzip)}`);
  }
  if (total.gzip > budget.total.gzip)
    failures.push(`total gzip ${kb(total.gzip)} > ${kb(budget.total.gzip)}`);
  if (failures.length) {
    console.error(`\nBundle budget exceeded:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nBundle budgets met.");
}
