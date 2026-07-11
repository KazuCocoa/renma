import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SCAN_FINDING_IMPLEMENTATION_FILES = [
  "src/rules.ts",
  "src/repeated-context.ts",
  "src/security-diagnostics.ts",
  "src/scanner.ts",
] as const;

const SCAN_FINDING_DOCUMENTATION_FILES = [
  "docs/diagnostics.md",
  "docs/metadata-budget.md",
] as const;

const FINDING_ID_PATTERN = /["'`]([A-Z][A-Z0-9]+-[A-Z0-9_-]+)["'`]/g;
const DOCUMENTED_ID_PATTERN = /^`([A-Z][A-Z0-9]+-[A-Z0-9_-]+)`$/;

test("all implemented scan finding identifiers are documented", async () => {
  const implementedIds = await collectImplementedFindingIds();
  const documentedIds = await collectAllDocumentedFindingIds();

  assert.ok(
    implementedIds.length > 0,
    "expected to find implemented scan finding identifiers",
  );
  assert.ok(
    documentedIds.length > 0,
    "expected documentation to contain scan finding identifier tables",
  );

  const documented = new Set(documentedIds);
  const missing = implementedIds.filter((id) => !documented.has(id));
  const implemented = new Set(implementedIds);
  const stale = documentedIds.filter((id) => !implemented.has(id));

  if (missing.length > 0) {
    assert.fail(
      [
        "scan finding documentation is missing implemented identifier(s):",
        ...missing.map((id) => `- ${id}`),
      ].join("\n"),
    );
  }

  if (stale.length > 0) {
    assert.fail(
      [
        "scan finding documentation includes identifier(s) that are not",
        "emitted by the current implementation:",
        ...stale.map((id) => `- ${id}`),
      ].join("\n"),
    );
  }
});

test("all Agent Skills diagnostic identifiers are centralized and documented", async () => {
  const registeredIds = await collectRegistryIds("AGENT_SKILL_DIAGNOSTIC_IDS");
  const source = await readFile(
    path.join(process.cwd(), "src/agent-skills.ts"),
    "utf8",
  );
  const rawIds = [...source.matchAll(/(["'`])((?:AS|RN)-SKILL-[A-Z0-9_-]+)\1/g)]
    .map((match) => match[2])
    .filter((id): id is string => Boolean(id));

  assert.deepEqual(
    rawIds,
    [],
    "Agent Skills emitters must reference AGENT_SKILL_DIAGNOSTIC_IDS",
  );

  const documentation = await readFile(
    path.join(process.cwd(), "docs/agent-skills-compatibility.md"),
    "utf8",
  );
  const documentedIds = collectDocumentedFindingIds(
    sectionByHeading(
      documentation,
      "## Agent Skills Diagnostic Identifiers",
      "docs/agent-skills-compatibility.md",
    ),
  );

  assertSameIdentifiers(
    registeredIds,
    documentedIds,
    "Agent Skills diagnostic documentation",
  );
});

async function collectImplementedFindingIds(): Promise<string[]> {
  const ids = new Set<string>(await collectRegistryIds("DIAGNOSTIC_IDS"));

  for (const file of SCAN_FINDING_IMPLEMENTATION_FILES) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    for (const match of source.matchAll(FINDING_ID_PATTERN)) {
      const id = match[1];
      if (id) ids.add(id);
    }
  }

  return [...ids].sort();
}

async function collectRegistryIds(registryName: string): Promise<string[]> {
  const source = await readFile(
    path.join(process.cwd(), "src/diagnostic-ids.ts"),
    "utf8",
  );
  const startMarker = `export const ${registryName} = {`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${registryName} registry`);
  const end = source.indexOf("} as const;", start);
  assert.notEqual(end, -1, `unterminated ${registryName} registry`);

  const ids = new Set<string>();
  for (const match of source.slice(start, end).matchAll(FINDING_ID_PATTERN)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

async function collectAllDocumentedFindingIds(): Promise<string[]> {
  const ids = new Set<string>();

  for (const file of SCAN_FINDING_DOCUMENTATION_FILES) {
    const documentation = await readFile(
      path.join(process.cwd(), file),
      "utf8",
    );
    for (const id of collectDocumentedFindingIds(
      documentedSection(file, documentation),
    )) {
      ids.add(id);
    }
  }

  return [...ids].sort();
}

function documentedSection(file: string, documentation: string): string {
  if (file !== "docs/diagnostics.md") return documentation;

  return sectionByHeading(
    documentation,
    "## Scan Finding Identifiers",
    "docs/diagnostics.md",
  );
}

function sectionByHeading(
  documentation: string,
  heading: string,
  file: string,
): string {
  const start = documentation.indexOf(heading);

  assert.notEqual(
    start,
    -1,
    `${file} must contain a ${heading.slice(3)} section`,
  );

  const bodyStart = start + heading.length;
  const nextHeading = documentation.slice(bodyStart).search(/\n## /);

  return nextHeading === -1
    ? documentation.slice(bodyStart)
    : documentation.slice(bodyStart, bodyStart + nextHeading);
}

function assertSameIdentifiers(
  implementedIds: string[],
  documentedIds: string[],
  label: string,
): void {
  const documented = new Set(documentedIds);
  const missing = implementedIds.filter((id) => !documented.has(id));
  const implemented = new Set(implementedIds);
  const stale = documentedIds.filter((id) => !implemented.has(id));

  assert.deepEqual(missing, [], `${label} is missing: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `${label} is stale: ${stale.join(", ")}`);
}

function collectDocumentedFindingIds(section: string): string[] {
  const ids = new Set<string>();
  const tableLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  assert.ok(
    tableLines.length >= 3,
    "scan finding documentation must contain a markdown table",
  );

  for (const line of tableLines.slice(2)) {
    const [identifierCell] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = identifierCell?.match(DOCUMENTED_ID_PATTERN)?.[1];

    if (id) ids.add(id);
  }

  return [...ids].sort();
}
