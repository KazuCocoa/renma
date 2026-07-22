import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import ts from "typescript";

interface SourceFileFixture {
  filePath: string;
  sourceText: string;
}

const LAYERS = [
  "foundation",
  "parsing",
  "repository",
  "analysis",
  "evidence",
  "decisions",
  "renderers",
  "commands",
  "cli",
] as const;

type Layer = (typeof LAYERS)[number];

interface LayerClassification {
  layer: Layer;
  reason: string;
}

interface RelativeDependency {
  kind: "runtime-import" | "type-import" | "re-export" | "type-re-export";
  specifier: string;
  targetPath: string;
}

interface DependencyViolation extends RelativeDependency {
  importingFile: string;
  importingLayer: Layer;
  targetLayer: Layer;
}

interface ArchitectureResult {
  unclassified: string[];
  violations: DependencyViolation[];
}

interface DependencyException {
  importingFile: string;
  targetPath: string;
  reason: string;
}

// Directory-owned layers classify new files automatically. Top-level modules
// remain explicit because their historical flat layout does not encode a layer.
const DIRECTORY_LAYERS: ReadonlyMap<string, LayerClassification> = new Map([
  [
    "src/security-destination",
    {
      layer: "analysis",
      reason: "pure security destination analysis",
    },
  ],
  [
    "src/evidence",
    { layer: "evidence", reason: "reusable evidence construction" },
  ],
  [
    "src/decisions",
    { layer: "decisions", reason: "authoritative decision construction" },
  ],
  [
    "src/guidance",
    { layer: "decisions", reason: "typed authoring guidance source" },
  ],
  ["src/renderers", { layer: "renderers", reason: "human presentation" }],
  ["src/commands", { layer: "commands", reason: "command orchestration" }],
]);

const TOP_LEVEL_MODULE_LAYERS: ReadonlyMap<string, LayerClassification> =
  new Map([
    ...topLevelModules(
      "foundation",
      "shared primitives, configuration, and stable contracts",
      [
        "command-invocation.ts",
        "config.ts",
        "dependency-resolution.ts",
        "diagnostic-ids.ts",
        "freshness.ts",
        "model.ts",
        "quality-profile.ts",
        "types.ts",
      ],
    ),
    ...topLevelModules("parsing", "source parsing and lexical projection", [
      "context-language-diagnostics.ts",
      "context-language.ts",
      "frontmatter-envelope.ts",
      "markdown-security-view.ts",
      "markdown-source-projection.ts",
      "markdown-syntax.ts",
      "markdown.ts",
      "token-estimator.ts",
      "yaml-frontmatter.ts",
    ]),
    ...topLevelModules(
      "repository",
      "repository collection, normalization, and snapshot projections",
      [
        "agent-skills.ts",
        "catalog-conflicts.ts",
        "catalog-lifecycle.ts",
        "catalog.ts",
        "context-lens.ts",
        "discovery.ts",
        "metadata.ts",
        "repository-boundary.ts",
        "repository-evidence.ts",
        "repository-paths.ts",
        "security-policy-inventory.ts",
        "security-policy.ts",
        "skill-discovery.ts",
        "skill-migration.ts",
        "static-support.ts",
      ],
    ),
    ...topLevelModules("analysis", "deterministic analysis and reporting IR", [
      "declared-composition.ts",
      "declared-impact.ts",
      "diagnostics-v2.ts",
      "repeated-context.ts",
      "rule-engine.ts",
      "rules.ts",
      "scanner.ts",
      "security-diagnostics.ts",
      "security-diff.ts",
      "security-posture.ts",
      "suppressions.ts",
      "trust-graph.ts",
    ]),
    ...topLevelModules("renderers", "top-level presentation compatibility", [
      "cli-help.ts",
      "report.ts",
    ]),
    ...topLevelModules("cli", "CLI entry and command dispatch", [
      "cli.ts",
      "index.ts",
    ]),
  ]);

// These edges are compatibility seams, not new direction. Each exception names
// one exact source and target and must be deleted when the seam is removed.
const DEPENDENCY_EXCEPTIONS: readonly DependencyException[] = [
  {
    importingFile: "src/types.ts",
    targetPath: "src/agent-skills.ts",
    reason: "legacy ScanResult composition hub; removed by the type split",
  },
  {
    importingFile: "src/types.ts",
    targetPath: "src/context-lens.ts",
    reason: "legacy ScanResult composition hub; removed by the type split",
  },
  {
    importingFile: "src/types.ts",
    targetPath: "src/security-policy-inventory.ts",
    reason: "legacy ScanResult composition hub; removed by the type split",
  },
  {
    importingFile: "src/types.ts",
    targetPath: "src/trust-graph.ts",
    reason: "legacy ScanResult composition hub; removed by the type split",
  },
  {
    importingFile: "src/repository-evidence.ts",
    targetPath: "src/evidence/classification.ts",
    reason:
      "snapshot construction owns the reusable classification index at its established deep-import path",
  },
];

const COMMAND_COMPATIBILITY_REEXPORTS = [
  {
    commandFile: "src/commands/inspect.ts",
    targetPath: "src/evidence/inspect.ts",
    names: [
      "InspectAssetSummary",
      "InspectOutline",
      "InspectRelationship",
      "InspectRelationshipChain",
      "InspectSlice",
    ],
    reason: "preserve the established command-module deep-import type contract",
  },
  {
    commandFile: "src/commands/suggest-metadata.ts",
    targetPath: "src/decisions/metadata-suggestion.ts",
    names: ["BlockedMetadata", "MetadataSuggestion"],
    reason: "preserve established suggestion result deep imports",
  },
] as const;

test("every production TypeScript module belongs to exactly one layer", async () => {
  const fixtures = await readProductionFixtures();
  const result = inspectArchitecture(fixtures);
  assert.deepEqual(result.unclassified, []);
});

test("internal source dependencies point toward the same or lower layers", async () => {
  const result = inspectArchitecture(await readProductionFixtures());
  if (result.violations.length > 0) {
    assert.fail(
      [
        "Internal dependency boundary violations:",
        ...result.violations.map(
          ({
            importingFile,
            importingLayer,
            kind,
            specifier,
            targetPath,
            targetLayer,
          }) =>
            `- ${importingFile} (${importingLayer}) ${kind} ${specifier} (${targetPath}, ${targetLayer})`,
        ),
      ].join("\n"),
    );
  }
});

test("command compatibility re-exports are exact and documented", async () => {
  const fixtures = await readProductionFixtures();
  const byPath = new Map(
    fixtures.map((fixture) => [fixture.filePath, fixture]),
  );
  for (const compatibility of COMMAND_COMPATIBILITY_REEXPORTS) {
    assert.ok(compatibility.reason.length > 0);
    const fixture = byPath.get(compatibility.commandFile);
    assert.ok(fixture, compatibility.commandFile);
    const dependency = readRelativeDependencies(
      compatibility.commandFile,
      fixture.sourceText,
      new Set(byPath.keys()),
    ).find(
      (candidate) =>
        candidate.targetPath === compatibility.targetPath &&
        candidate.kind === "type-re-export",
    );
    assert.ok(
      dependency,
      `${compatibility.commandFile} must retain its documented type re-export from ${compatibility.targetPath}`,
    );
    for (const name of compatibility.names) {
      assert.match(fixture.sourceText, new RegExp(`\\b${name}\\b`));
    }
  }
});

test("an unclassified new top-level module fails architecture validation", () => {
  assert.deepEqual(
    inspectArchitecture([
      { filePath: "src/future-module.ts", sourceText: "export {};" },
    ]).unclassified,
    ["src/future-module.ts"],
  );
});

test("an illegal runtime import is rejected", () => {
  assertViolation(
    "src/rules.ts",
    'import { run } from "./commands/scan.js";',
    "runtime-import",
    "analysis",
    "commands",
  );
});

test("an illegal type-only import is rejected", () => {
  assertViolation(
    "src/catalog.ts",
    'import type { Output } from "./renderers/inspect.js";',
    "type-import",
    "repository",
    "renderers",
  );
});

test("an illegal re-export is rejected", () => {
  assertViolation(
    "src/markdown.ts",
    'export { run } from "./commands/scan.js";',
    "re-export",
    "parsing",
    "commands",
  );
});

test("same-layer and lower-layer dependencies are valid", () => {
  assert.deepEqual(
    inspectArchitecture([
      {
        filePath: "src/catalog.ts",
        sourceText: 'import { parse } from "./metadata.js";',
      },
      {
        filePath: "src/rules.ts",
        sourceText: 'import { build } from "./catalog.js";',
      },
    ]).violations,
    [],
  );
});

async function readProductionFixtures(): Promise<SourceFileFixture[]> {
  const sourceFiles = await readTypeScriptFiles(
    path.join(process.cwd(), "src"),
  );
  return Promise.all(
    sourceFiles.map(async (filePath) => ({
      filePath: normalizePath(path.relative(process.cwd(), filePath)),
      sourceText: await readFile(filePath, "utf8"),
    })),
  );
}

async function readTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return nestedFiles.flat().sort();
}

function inspectArchitecture(
  sourceFiles: readonly SourceFileFixture[],
): ArchitectureResult {
  const knownSourcePaths = new Set(
    sourceFiles.map(({ filePath }) => normalizePath(filePath)),
  );
  const unclassified: string[] = [];
  const violations: DependencyViolation[] = [];

  for (const sourceFile of sourceFiles) {
    const importingFile = normalizePath(sourceFile.filePath);
    const importingClassification = classifySourceFile(importingFile);
    if (!importingClassification) {
      unclassified.push(importingFile);
      continue;
    }
    const dependencies = readRelativeDependencies(
      importingFile,
      sourceFile.sourceText,
      knownSourcePaths,
    );
    for (const dependency of dependencies) {
      const targetClassification = classifySourceFile(dependency.targetPath);
      if (!targetClassification) continue;
      if (
        canDependOn(
          importingClassification.layer,
          targetClassification.layer,
        ) ||
        isDependencyException(importingFile, dependency.targetPath)
      ) {
        continue;
      }
      violations.push({
        importingFile,
        importingLayer: importingClassification.layer,
        ...dependency,
        targetLayer: targetClassification.layer,
      });
    }
  }

  return {
    unclassified: unclassified.sort(),
    violations,
  };
}

function classifySourceFile(filePath: string): LayerClassification | undefined {
  const normalized = normalizePath(filePath);
  const topLevel = TOP_LEVEL_MODULE_LAYERS.get(normalized);
  if (topLevel) return topLevel;

  for (const [directory, classification] of DIRECTORY_LAYERS) {
    if (isWithinDirectory(normalized, directory)) return classification;
  }
  return undefined;
}

function canDependOn(importingLayer: Layer, targetLayer: Layer): boolean {
  return LAYERS.indexOf(targetLayer) <= LAYERS.indexOf(importingLayer);
}

function isDependencyException(
  importingFile: string,
  targetPath: string,
): boolean {
  return DEPENDENCY_EXCEPTIONS.some(
    (exception) =>
      exception.importingFile === importingFile &&
      exception.targetPath === targetPath &&
      exception.reason.length > 0,
  );
}

function readRelativeDependencies(
  importingFile: string,
  sourceText: string,
  knownSourcePaths: ReadonlySet<string>,
): RelativeDependency[] {
  const sourceFile = ts.createSourceFile(
    importingFile,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const dependencies: RelativeDependency[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier;
    if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) continue;
    const specifier = moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;

    dependencies.push({
      kind: ts.isImportDeclaration(statement)
        ? statement.importClause?.isTypeOnly
          ? "type-import"
          : "runtime-import"
        : statement.isTypeOnly
          ? "type-re-export"
          : "re-export",
      specifier,
      targetPath: resolveSourcePath(importingFile, specifier, knownSourcePaths),
    });
  }

  return dependencies;
}

function resolveSourcePath(
  importingFile: string,
  specifier: string,
  knownSourcePaths: ReadonlySet<string>,
): string {
  const normalizedTarget = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(importingFile),
      normalizePath(specifier),
    ),
  );
  if (normalizedTarget.endsWith(".js")) {
    return `${normalizedTarget.slice(0, -3)}.ts`;
  }

  const fileCandidate = `${normalizedTarget}.ts`;
  if (knownSourcePaths.has(fileCandidate)) return fileCandidate;
  const indexCandidate = `${normalizedTarget}/index.ts`;
  if (knownSourcePaths.has(indexCandidate)) return indexCandidate;
  return normalizedTarget;
}

function assertViolation(
  importingFile: string,
  sourceText: string,
  kind: RelativeDependency["kind"],
  importingLayer: Layer,
  targetLayer: Layer,
): void {
  const result = inspectArchitecture([{ filePath: importingFile, sourceText }]);
  assert.equal(result.violations.length, 1);
  assert.deepEqual(result.violations[0], {
    importingFile,
    importingLayer,
    kind,
    specifier: sourceText.match(/"([^"]+)"/)?.[1],
    targetPath:
      importingFile === "src/catalog.ts"
        ? "src/renderers/inspect.ts"
        : "src/commands/scan.ts",
    targetLayer,
  });
}

function topLevelModules(
  layer: Layer,
  reason: string,
  filenames: readonly string[],
): Array<[string, LayerClassification]> {
  return filenames.map((filename) => [
    `src/${filename}`,
    { layer, reason: `${reason}: ${filename}` },
  ]);
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  return filePath.startsWith(`${directory}/`);
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
