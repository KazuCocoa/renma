import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import ts from "typescript";

interface SourceFileFixture {
  filePath: string;
  sourceText: string;
}

interface RelativeDependency {
  specifier: string;
  targetPath: string;
}

interface DependencyRule {
  importingPaths: readonly string[];
  importingPathKind: "directory" | "file";
  forbiddenDirectory: string;
  description: string;
}

interface DependencyViolation extends RelativeDependency {
  importingFile: string;
  rule: string;
}

// Commands are the outer orchestration layer. Evidence stays reusable outside
// commands, decisions stay independent of human presentation, and renderers may
// consume evidence and decisions but never command modules. Type-only imports
// count because they still create an architectural dependency even when erased
// at runtime.
const dependencyRules: readonly DependencyRule[] = [
  {
    importingPaths: ["src/evidence"],
    importingPathKind: "directory",
    forbiddenDirectory: "src/commands",
    description: "evidence modules must not import command modules",
  },
  {
    importingPaths: ["src/evidence"],
    importingPathKind: "directory",
    forbiddenDirectory: "src/renderers",
    description: "evidence modules must not import renderer modules",
  },
  {
    importingPaths: ["src/decisions"],
    importingPathKind: "directory",
    forbiddenDirectory: "src/commands",
    description: "decision modules must not import command modules",
  },
  {
    importingPaths: ["src/decisions"],
    importingPathKind: "directory",
    forbiddenDirectory: "src/renderers",
    description: "decision modules must not import renderer modules",
  },
  {
    importingPaths: ["src/renderers"],
    importingPathKind: "directory",
    forbiddenDirectory: "src/commands",
    description: "renderer modules must not import command modules",
  },
  {
    importingPaths: [
      "src/repository-evidence.ts",
      "src/discovery.ts",
      "src/catalog.ts",
      "src/metadata.ts",
      "src/markdown.ts",
    ],
    importingPathKind: "file",
    forbiddenDirectory: "src/commands",
    description:
      "repository and resolution modules must not import command modules",
  },
  {
    importingPaths: [
      "src/repository-evidence.ts",
      "src/discovery.ts",
      "src/catalog.ts",
      "src/metadata.ts",
      "src/markdown.ts",
    ],
    importingPathKind: "file",
    forbiddenDirectory: "src/renderers",
    description:
      "repository and resolution modules must not import renderer modules",
  },
];

test("internal source dependencies point toward lower layers", async () => {
  const sourceFiles = await readTypeScriptFiles(
    path.join(process.cwd(), "src"),
  );
  const fixtures = await Promise.all(
    sourceFiles.map(async (filePath) => ({
      filePath: normalizePath(path.relative(process.cwd(), filePath)),
      sourceText: await readFile(filePath, "utf8"),
    })),
  );
  const violations = findDependencyViolations(fixtures);

  if (violations.length > 0) {
    assert.fail(
      [
        "Internal dependency boundary violations:",
        ...violations.map(
          ({ importingFile, specifier, targetPath, rule }) =>
            `- ${importingFile} imports ${specifier} (${targetPath}): ${rule}`,
        ),
      ].join("\n"),
    );
  }
});

test("dependency checker covers static imports and re-exports", () => {
  const fixtures: readonly SourceFileFixture[] = [
    {
      filePath: "src/evidence/value.ts",
      sourceText: `
        import { run } from "../commands/run.js";
        import type { CommandOptions } from "../commands/options.js";
        const example = 'import { ignored } from "../commands/ignored.js"';
        // export { ignored } from "../renderers/ignored.js";
        void example;
      `,
    },
    {
      filePath: "src/decisions/value.ts",
      sourceText: `
        export { render } from "../renderers/value.js";
        export type { RenderOptions } from "../renderers/options.js";
      `,
    },
    {
      filePath: "src/renderers/value.ts",
      sourceText: `
        import type { CommandResult } from "../commands/value.js";
        import type { Evidence } from "../evidence/value.js";
        import yaml from "yaml";
        void yaml;
      `,
    },
    {
      filePath: "src/commands/value.ts",
      sourceText: `
        import { collect } from "../evidence/collect.js";
        export type { InspectOutline } from "../evidence/inspect.js";
        void collect;
      `,
    },
  ];

  assert.deepEqual(
    findDependencyViolations(fixtures).map(
      ({ importingFile, specifier, targetPath, rule }) => ({
        importingFile,
        specifier,
        targetPath,
        rule,
      }),
    ),
    [
      {
        importingFile: "src/evidence/value.ts",
        specifier: "../commands/run.js",
        targetPath: "src/commands/run.ts",
        rule: "evidence modules must not import command modules",
      },
      {
        importingFile: "src/evidence/value.ts",
        specifier: "../commands/options.js",
        targetPath: "src/commands/options.ts",
        rule: "evidence modules must not import command modules",
      },
      {
        importingFile: "src/decisions/value.ts",
        specifier: "../renderers/value.js",
        targetPath: "src/renderers/value.ts",
        rule: "decision modules must not import renderer modules",
      },
      {
        importingFile: "src/decisions/value.ts",
        specifier: "../renderers/options.js",
        targetPath: "src/renderers/options.ts",
        rule: "decision modules must not import renderer modules",
      },
      {
        importingFile: "src/renderers/value.ts",
        specifier: "../commands/value.js",
        targetPath: "src/commands/value.ts",
        rule: "renderer modules must not import command modules",
      },
    ],
  );
});

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

function findDependencyViolations(
  sourceFiles: readonly SourceFileFixture[],
): DependencyViolation[] {
  const knownSourcePaths = new Set(
    sourceFiles.map(({ filePath }) => normalizePath(filePath)),
  );
  const violations: DependencyViolation[] = [];

  for (const sourceFile of sourceFiles) {
    const importingFile = normalizePath(sourceFile.filePath);
    const dependencies = readRelativeDependencies(
      importingFile,
      sourceFile.sourceText,
      knownSourcePaths,
    );
    for (const dependency of dependencies) {
      for (const rule of dependencyRules) {
        if (
          matchesImportingPath(importingFile, rule) &&
          isWithinDirectory(dependency.targetPath, rule.forbiddenDirectory)
        ) {
          violations.push({
            importingFile,
            ...dependency,
            rule: rule.description,
          });
        }
      }
    }
  }

  return violations;
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

function matchesImportingPath(
  importingFile: string,
  rule: DependencyRule,
): boolean {
  return rule.importingPaths.some((importingPath) =>
    rule.importingPathKind === "file"
      ? importingFile === importingPath
      : isWithinDirectory(importingFile, importingPath),
  );
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
