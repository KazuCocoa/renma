#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { format } from "prettier";
import { API, SymbolFlags } from "typescript/unstable/sync";
import {
  isClassDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";

const SNAPSHOT_PATH = "test/fixtures/public-types-api.snapshot.json";
const SUPPORTED_ENTRYPOINTS = new Map([
  ["renma/types", "dist/public-types.d.ts"],
  ["renma/types/classification", "dist/types/classification.d.ts"],
  ["renma/types/diagnostics", "dist/types/diagnostics.d.ts"],
  ["renma/types/scan-result", "dist/public-types/scan-result.d.ts"],
  ["renma/discovery", "dist/public-discovery.d.ts"],
]);

if (isMainModule()) {
  await main();
}

async function main() {
  const writeSnapshot = process.argv.includes("--write");
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--write");
  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown public API verification option: ${unknownArgs[0]}`,
    );
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

  const snapshot = createPublicApiSnapshot({
    entrypoints: SUPPORTED_ENTRYPOINTS,
    ownedDeclarationRoots: [path.resolve("dist")],
  });
  const serialized = normalizeLineEndings(
    await format(JSON.stringify(snapshot), { parser: "json" }),
  );
  if (writeSnapshot) {
    await writeFile(SNAPSHOT_PATH, serialized, "utf8");
    process.stdout.write(`Updated ${SNAPSHOT_PATH}.\n`);
    return;
  }

  const expected = normalizeLineEndings(await readFile(SNAPSHOT_PATH, "utf8"));
  if (expected !== serialized) {
    const difference = firstDifference(expected, serialized);
    throw new Error(
      `Public TypeScript API changed at ${difference}. Review compatibility, then run npm run update:api only for an intentional boundary change.`,
    );
  }

  process.stdout.write(
    `Verified ${SUPPORTED_ENTRYPOINTS.size} supported TypeScript entrypoints against ${SNAPSHOT_PATH}.\n`,
  );
}

/**
 * Snapshot the complete graph of Renma-owned declarations reachable from each
 * supported package export. Declarations outside ownedDeclarationRoots are
 * deliberately treated as external dependency contracts and are not expanded.
 */
export function createPublicApiSnapshot({
  entrypoints,
  ownedDeclarationRoots,
}) {
  const declarationFiles = [...entrypoints.values()].map((file) =>
    path.resolve(file),
  );
  const ownedRoots = ownedDeclarationRoots.map((root) => path.resolve(root));
  const api = new API();
  try {
    const compilerSnapshot = api.updateSnapshot({
      openFiles: declarationFiles,
    });
    const declarations = new Map();
    const pending = [];
    const entrypointSnapshots = Object.fromEntries(
      [...entrypoints].map(([specifier, declarationPath]) => [
        specifier,
        publicModuleRoots(
          compilerSnapshot,
          path.resolve(declarationPath),
          ownedRoots,
          declarations,
          pending,
        ),
      ]),
    );

    while (pending.length > 0) {
      const current = pending.shift();
      collectDeclarationReferences(current, ownedRoots, declarations, pending);
    }

    return {
      version: 2,
      entrypoints: entrypointSnapshots,
      declarations: Object.fromEntries(
        [...declarations]
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([id, declaration]) => [
            id,
            {
              declarations: declaration.text,
              references: [...declaration.references].sort(compareCodeUnits),
            },
          ]),
      ),
    };
  } finally {
    api.close();
  }
}

function publicModuleRoots(
  compilerSnapshot,
  declarationFile,
  ownedRoots,
  declarations,
  pending,
) {
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
      .map((symbol) => [
        symbol.name,
        registerSymbol(project, symbol, ownedRoots, declarations, pending),
      ])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function registerSymbol(project, symbol, ownedRoots, declarations, pending) {
  const target = resolveAliases(project, symbol);
  const nodes = ownedApiDeclarations(project, target, ownedRoots);
  if (nodes.length === 0) {
    throw new Error(
      `Public export ${symbol.name} has no Renma-owned declaration. External declarations must be wrapped by a Renma-owned public contract.`,
    );
  }
  const id = declarationId(target, nodes, ownedRoots);
  if (!declarations.has(id)) {
    const declaration = {
      id,
      project,
      symbol: target,
      nodes,
      text: [
        ...new Set(
          nodes.map((node) =>
            normalizeDeclaration(project.emitter.printNode(node)),
          ),
        ),
      ].sort(compareCodeUnits),
      references: new Set(),
    };
    declarations.set(id, declaration);
    pending.push(declaration);
  }
  return id;
}

function collectDeclarationReferences(
  declaration,
  ownedRoots,
  declarations,
  pending,
) {
  const identifierNodes = declaration.nodes.flatMap(collectIdentifiers);
  const referencedSymbols =
    declaration.project.checker.getSymbolAtLocation(identifierNodes);
  for (const symbol of referencedSymbols) {
    if (!symbol) continue;
    const target = resolveAliases(declaration.project, symbol);
    const nodes = ownedApiDeclarations(declaration.project, target, ownedRoots);
    if (nodes.length === 0) continue;
    const id = registerSymbol(
      declaration.project,
      target,
      ownedRoots,
      declarations,
      pending,
    );
    if (id !== declaration.id) declaration.references.add(id);
  }
}

function collectIdentifiers(root) {
  const identifiers = [];
  visit(root);
  return identifiers;

  function visit(node) {
    if (isIdentifier(node)) identifiers.push(node);
    node.forEachChild(visit);
  }
}

function resolveAliases(project, symbol) {
  const seen = new Set();
  let current = symbol;
  while (!seen.has(current.id) && (current.flags & SymbolFlags.Alias) !== 0) {
    seen.add(current.id);
    const target = project.checker.getImmediateAliasedSymbol(current);
    if (!target) return current;
    current = target;
  }
  return current;
}

function ownedApiDeclarations(project, symbol, ownedRoots) {
  return symbol.declarations
    .flatMap((handle) => {
      const node = handle.resolve(project);
      return node &&
        isApiDeclaration(node) &&
        isOwnedDeclaration(project, node, ownedRoots)
        ? [node]
        : [];
    })
    .sort((left, right) => {
      const fileOrder = compareCodeUnits(
        left.getSourceFile().fileName,
        right.getSourceFile().fileName,
      );
      return fileOrder || left.pos - right.pos;
    });
}

function isApiDeclaration(node) {
  return (
    isClassDeclaration(node) ||
    isEnumDeclaration(node) ||
    isFunctionDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isModuleDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isVariableDeclaration(node)
  );
}

function isOwnedDeclaration(project, node, ownedRoots) {
  const sourceFile = node.getSourceFile();
  if (
    !sourceFile.isDeclarationFile ||
    project.program.isSourceFileDefaultLibrary(sourceFile) ||
    project.program.isSourceFileFromExternalLibrary(sourceFile)
  ) {
    return false;
  }
  return ownedRoots.some((root) => isPathInside(root, sourceFile.fileName));
}

function declarationId(symbol, nodes, ownedRoots) {
  const sourceFile = nodes[0]?.getSourceFile();
  if (!sourceFile) throw new Error(`Missing declaration for ${symbol.name}.`);
  const root = ownedRoots.find((candidate) =>
    isPathInside(candidate, sourceFile.fileName),
  );
  if (!root)
    throw new Error(`Declaration for ${symbol.name} is not Renma-owned.`);
  const relativePath = path
    .relative(root, sourceFile.fileName)
    .split(path.sep)
    .join("/");
  return `${relativePath}#${symbol.name}`;
}

function isPathInside(root, fileName) {
  const relative = path.relative(root, path.resolve(fileName));
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function normalizeDeclaration(declaration) {
  return declaration
    .replace(/\/\*\*[\s\S]*?\*\//gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeLineEndings(value) {
  return value.replace(/\r\n?/gu, "\n");
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

function isMainModule() {
  return Boolean(
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
      path.resolve(fileURLToPath(import.meta.url)),
  );
}
