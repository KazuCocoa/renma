#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { format } from "prettier";
import { API } from "typescript/unstable/sync";
import { isExportSpecifier } from "typescript/unstable/ast/is";

const SNAPSHOT_PATH = "test/fixtures/public-types-api.snapshot.json";
const SUPPORTED_ENTRYPOINTS = new Map([
  ["renma/types", "dist/public-types.d.ts"],
  ["renma/types/classification", "dist/types/classification.d.ts"],
  ["renma/types/diagnostics", "dist/types/diagnostics.d.ts"],
  ["renma/types/scan-result", "dist/public-types/scan-result.d.ts"],
  ["renma/discovery", "dist/public-discovery.d.ts"],
]);

const writeSnapshot = process.argv.includes("--write");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--write");
if (unknownArgs.length > 0) {
  throw new Error(`Unknown public API verification option: ${unknownArgs[0]}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const actualExportKeys = Object.keys(packageJson.exports ?? {}).sort();
const expectedExportKeys = [
  "./package.json",
  ...[...SUPPORTED_ENTRYPOINTS.keys()].map(packageExportKey),
].sort();
if (JSON.stringify(actualExportKeys) !== JSON.stringify(expectedExportKeys)) {
  throw new Error(
    `Supported package entrypoints changed. Expected ${expectedExportKeys.join(", ")}; received ${actualExportKeys.join(", ")}.`,
  );
}

for (const [specifier, declarationPath] of SUPPORTED_ENTRYPOINTS) {
  const exported = packageJson.exports[packageExportKey(specifier)];
  if (exported?.types !== `./${declarationPath}`) {
    throw new Error(
      `${specifier} must resolve its types condition to ./${declarationPath}.`,
    );
  }
}

const declarationFiles = [...SUPPORTED_ENTRYPOINTS.values()].map((file) =>
  path.resolve(file),
);
const api = new API();
let snapshot;
try {
  const compilerSnapshot = api.updateSnapshot({ openFiles: declarationFiles });
  snapshot = {
    version: 1,
    entrypoints: Object.fromEntries(
      [...SUPPORTED_ENTRYPOINTS].map(([specifier, declarationPath]) => [
        specifier,
        publicModuleSnapshot(compilerSnapshot, path.resolve(declarationPath)),
      ]),
    ),
  };
} finally {
  api.close();
}

const serialized = await format(JSON.stringify(snapshot), { parser: "json" });
if (writeSnapshot) {
  await writeFile(SNAPSHOT_PATH, serialized);
  process.stdout.write(`Updated ${SNAPSHOT_PATH}.\n`);
  process.exit(0);
}

const expected = await readFile(SNAPSHOT_PATH, "utf8");
if (expected !== serialized) {
  const difference = firstDifference(expected, serialized);
  throw new Error(
    `Public TypeScript API changed at ${difference}. Review compatibility, then run npm run update:api only for an intentional boundary change.`,
  );
}

process.stdout.write(
  `Verified ${SUPPORTED_ENTRYPOINTS.size} supported TypeScript entrypoints against ${SNAPSHOT_PATH}.\n`,
);

function publicModuleSnapshot(compilerSnapshot, declarationFile) {
  const project = compilerSnapshot.getDefaultProjectForFile(declarationFile);
  if (!project) {
    throw new Error(
      `TypeScript did not load ${declarationFile}. Run npm run build.`,
    );
  }
  const sourceFile = project.program.getSourceFile(declarationFile);
  if (!sourceFile) {
    throw new Error(
      `Missing declaration file ${declarationFile}. Run npm run build.`,
    );
  }
  const moduleSymbol = project.checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(
      `TypeScript found no module symbol for ${declarationFile}.`,
    );
  }

  return Object.fromEntries(
    project.checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => [symbol.name, declarationsForExport(project, symbol)])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function declarationsForExport(project, symbol) {
  const declarations = symbol.declarations.flatMap((handle) => {
    const node = handle.resolve(project);
    if (!node) return [];
    const localTarget = isExportSpecifier(node)
      ? project.checker.getExportSpecifierLocalTargetSymbol(node)
      : undefined;
    const handles = localTarget?.declarations ?? [handle];
    return handles.flatMap((targetHandle) => {
      const target = targetHandle.resolve(project);
      return target
        ? [normalizeDeclaration(project.emitter.printNode(target))]
        : [];
    });
  });
  return [...new Set(declarations)].sort(compareCodeUnits);
}

function normalizeDeclaration(declaration) {
  return declaration
    .replace(/\/\*\*[\s\S]*?\*\//gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function packageExportKey(specifier) {
  return `.${specifier.slice("renma".length)}`;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const count = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < count; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `line ${index + 1} (expected ${JSON.stringify(expectedLines[index])}, received ${JSON.stringify(actualLines[index])})`;
    }
  }
  return "unknown location";
}
