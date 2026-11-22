import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import { parseSync, Visitor } from "oxc-parser";

const scriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];
const isScript = (file) => scriptExtensions.includes(posix.extname(file));

const ownerPaths = [
  "src/main.tsx",
  "src/app",
  "src/components/forms",
  "src/components/HomeLink.tsx",
  "src/components/RecordDialog.tsx",
  "src/hooks/useConfirmation.tsx",
  "src/hooks/useOfflineCopies.ts",
  "src/hooks/useRecordDialog.ts",
  "src/hooks/useRecordForm.ts",
  "src/lib/auth.ts",
  "src/lib/labels.ts",
  "src/lib/navigation-guard.ts",
  "src/lib/offline-store.ts",
  "src/lib/query",
  "src/lib/record-recovery.ts",
  "src/lib/unreadable-entry.ts",
];

const inside = (file, directory) => file === directory || file.startsWith(directory + "/");
const isOwner = (file) =>
  (inside(file, "src/features") && !inside(file, "src/features/visitor")) ||
  /^(?:owner-|Owner[A-Z])/.test(posix.basename(file)) ||
  ownerPaths.some((path) => inside(file, path));

function dependencies(file, source) {
  const syntax = parseSync(file, source);
  if (syntax.errors.length) throw new Error(`${file}: ${syntax.errors[0].message}`);

  const imports = syntax.module.staticImports.map((entry) => entry.moduleRequest.value);
  for (const group of syntax.module.staticExports) {
    for (const entry of group.entries) {
      if (entry.moduleRequest) imports.push(entry.moduleRequest.value);
    }
  }

  function literal(node) {
    if (node?.type === "Literal" && typeof node.value === "string") {
      imports.push(node.value);
    } else if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
      imports.push(node.quasis[0].value.cooked);
    } else {
      throw new Error(`${file}: Visitor dependencies must use literal module specifiers`);
    }
  }

  new Visitor({
    ImportExpression: (node) => literal(node.source),
    TSImportType: (node) => literal(node.source),
    TSExternalModuleReference: (node) => literal(node.expression),
    CallExpression({ callee, arguments: args }) {
      if (callee.type === "Identifier" && callee.name === "require") literal(args[0]);
    },
    MemberExpression({ object, property, computed }) {
      if (
        object.type === "MetaProperty" &&
        object.meta.name === "import" &&
        (computed ? property.value === "glob" : property.name === "glob")
      ) {
        throw new Error(
          `${file}: Use explicit imports for visitor dependencies instead of import.meta.glob`,
        );
      }
    },
  }).visit(syntax.program);
  return imports;
}

function localFile(root, importer, specifier) {
  const path = specifier.split("?")[0];
  let base;
  if (path.startsWith("@/")) base = "src/" + path.slice(2);
  else if (path.startsWith("./") || path.startsWith("../")) {
    base = posix.join(posix.dirname(importer), path);
  } else if (path.startsWith("/")) base = path.slice(1);
  else return; // Bare package import.

  base = posix.normalize(base);
  if (!inside(base, "src")) {
    throw new Error(`${importer}: Visitor import leaves src: ${specifier}`);
  }
  // Paraglide is independently generated. It may be absent when lint runs.
  if (inside(base, "src/paraglide")) return;

  const stem = base.replace(/\.js$/, "");
  const candidates = [
    base,
    ...scriptExtensions.map((extension) => stem + extension),
    ...scriptExtensions.map((extension) => base + "/index" + extension),
  ];
  const file = candidates.find((candidate) =>
    statSync(resolve(root, candidate), { throwIfNoEntry: false })?.isFile(),
  );
  if (!file) throw new Error(`${importer}: Cannot resolve visitor import ${specifier}`);
  return file;
}

export function checkVisitorImports(root) {
  const visitorDirectory = "src/features/visitor";
  const entries = [
    "src/visitor-main.tsx",
    ...readdirSync(resolve(root, visitorDirectory), { recursive: true })
      .filter(isScript)
      .sort()
      .map((file) => visitorDirectory + "/" + file),
  ];
  const visited = new Set();

  function visit(file, parents) {
    const chain = [...parents, file];
    if (isOwner(file) || inside(file, "src/mocks")) {
      const audience = isOwner(file) ? "owner-only" : "test-only";
      throw new Error(`Visitor imports ${audience} code: ${chain.join(" -> ")}`);
    }
    if (visited.has(file) || !isScript(file) || inside(file, "src/api-schema")) return;
    visited.add(file);
    for (const specifier of dependencies(file, readFileSync(resolve(root, file), "utf8"))) {
      const target = localFile(root, file, specifier);
      if (target) visit(target, chain);
    }
  }

  for (const entry of entries) visit(entry, []);
}
