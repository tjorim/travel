import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

/** Compare declarations as well as interpolation: an unused input is still part of the typed contract. */
export function catalogueErrors(base, translation) {
  const errors = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(translation)])) {
    if (!(key in base) || !(key in translation)) {
      errors.push(`${key}: missing catalogue key`);
      continue;
    }
    const signature = (message) =>
      typeof message === "string"
        ? { inputs: placeholders(message) }
        : message.map((variant) => ({
            declarations: [...(variant.declarations ?? [])].sort(),
            selectors: variant.selectors ?? [],
            matches: Object.fromEntries(
              Object.entries(variant.match)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([selector, text]) => [selector, placeholders(text)]),
            ),
          }));
    if (JSON.stringify(signature(base[key])) !== JSON.stringify(signature(translation[key])))
      errors.push(`${key}: interpolation, declaration or selector mismatch`);
  }
  return errors;
}

// Exact source/value exclusions. Never approve a whole component or directory for visible copy.
const exclusions = {
  "locale.tsx": {
    Nederlands: "language autonym",
    English: "language autonym",
    "Travel ·": "fixed application title brand",
  },
  "visitor-routes.tsx": { Travel: "fixed application brand" },
  "TripMap.tsx": {
    "© OpenFreeMap": "provider attribution",
    OpenMapTiles: "provider attribution",
    "© OpenStreetMap": "provider attribution",
    "© Mapterhorn": "provider attribution",
    "© Esri": "provider attribution",
    ", Maxar, Earthstar Geographics, and the GIS User Community": "provider attribution",
  },
  "auth-context.tsx": { "Travel tracker authentication context is missing.": "internal invariant diagnostic" },
  "tracker-model.ts": { kB: "file size unit" },
  "trips/PackingManager.tsx": { kg: "SI weight unit" },
  "auth.ts": { "openid profile email": "OIDC scopes" },
  "map-style.ts": { "Noto Sans Regular": "provider glyph font", HTTP: "internal status diagnostic" },
  "query/api.ts": {
    "Invalid API response": "diagnostic kept outside interface feedback",
    Bearer: "HTTP authorization scheme",
  },
  "pages/Settings.tsx": { "Google Photos": "provider brand", "GoPro Cloud": "provider brand" },
  "trips/CaptureDialog.tsx": { connection: "CSS class fragment" },
  "trips/MediaManager.tsx": {
    "media-thumbnail-placeholder": "CSS class fragment",
    "Google Photos": "provider brand",
    "GoPro Cloud": "provider brand",
    "s ·": "SI seconds unit and metadata separator",
  },
  "offline/OfflineSnapshotView.tsx": { "Medische notitie": "legacy enum lookup key, never rendered literally" },
  "trips/RouteManager.tsx": {
    "Europe/Amsterdam": "IANA input example",
    "Asia/Taipei": "IANA input example",
    "BR-087": "service reference input example",
  },
  "trips/StayManager.tsx": { TW: "ISO country input example", "https://": "URL input example" },
};
const copyAttribute = /^(?:aria-label|aria-description|title|label|ariaLabel|placeholder|alt|description)$/;
const machine = (text) =>
  /^(?:[DMYHhmsZd]+[ ,:\-]*)+$/.test(text) ||
  /^(?:[DMYHhmsZd]+[ ,:\-]*)*(?:MMMM|MMM|ddd)(?:[DMYHhmsZd ,:\-]*)*$/.test(text) ||
  text
    .split(/\s+/)
    .every(
      (token) =>
        /^(?:[\w:[\]!./%-]*-)[\w:[\]!./%-]+$/.test(token) ||
        ["block", "grid", "fixed", "relative", "flex", "border", "rounded", "peer", "secondary", "compact"].includes(
          token,
        ),
    );

/** A review aid, not a proof about dynamic or authored data. --all lists every literal for manual tracing. */
export function sourceCandidates(source, file = "source.tsx", all = false) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.trim();
      const parent = ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
      const attr = ts.isJsxAttribute(parent) ? parent.name.getText(tree) : "";
      const imported = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      const templateCopy =
        (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
        /\s/.test(node.text) &&
        /[A-Za-zÀ-ž]{2}/.test(text);
      let ancestor = parent;
      let fieldMapping = false;
      while (ancestor && !ts.isFunctionLike(ancestor)) {
        if (
          (ts.isPropertyAssignment(ancestor) || ts.isVariableDeclaration(ancestor)) &&
          ancestor.name.getText(tree) === "serverFields"
        )
          fieldMapping = true;
        ancestor = ancestor.parent;
      }
      const propertyCopy =
        !fieldMapping &&
        ts.isPropertyAssignment(parent) &&
        parent.initializer === node &&
        /^(?:label|title|placeholder|description|alt)$/.test(parent.name.getText(tree));
      const visible =
        templateCopy || ts.isJsxText(node) || ts.isJsxElement(parent) || copyAttribute.test(attr) || propertyCopy;
      if (
        /[A-Za-zÀ-ž]/.test(text) &&
        !imported &&
        (all || visible || /\s/.test(text)) &&
        (all || (attr !== "className" && (visible || !machine(text))))
      ) {
        result.push({ line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}
/** A top-level message call freezes copy before any locale switch. Store the function instead. */
export function frozenMessageCalls(source, file = "source.tsx") {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(tree) === "m"
    ) {
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      if (!parent) lines.push(tree.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return lines;
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "paraglide" ? [] : files(file);
    return /\.(?:tsx?|js)$/.test(file) && !/(?:\.test\.|test-|fake-api|test-utils)/.test(file) ? [file] : [];
  });
}
function main() {
  const all = process.argv.includes("--all");
  const errors = catalogueErrors(
    JSON.parse(fs.readFileSync(path.join(root, "messages/nl.json"))),
    JSON.parse(fs.readFileSync(path.join(root, "messages/en.json"))),
  );
  const sources = files(path.join(root, "src"));
  for (const file of sources) {
    const relative = path.relative(path.join(root, "src"), file);
    for (const line of frozenMessageCalls(fs.readFileSync(file, "utf8"), relative))
      errors.push(`${relative}:${line}: module-level translated snapshot; retain the message function`);
    for (const candidate of sourceCandidates(fs.readFileSync(file, "utf8"), relative, all)) {
      const reason = exclusions[relative]?.[candidate.text];
      const entry = `${relative}:${candidate.line} ${JSON.stringify(candidate.text)}`;
      if (all) console.log(`${entry}${reason ? ` — ${reason}` : ""}`);
      else if (!reason) errors.push(entry);
    }
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Locale audit passed: ${sources.length} production source files; Dutch/English catalogue contracts match.`,
    );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
