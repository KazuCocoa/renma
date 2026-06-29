import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SCAN_FINDING_IMPLEMENTATION_FILES = [
  "src/diagnostic-ids.ts",
  "src/rules.ts",
  "src/repeated-context.ts",
  "src/security-diagnostics.ts",
  "src/scanner.ts",
] as const;

const FINDING_ID_PATTERN = /["'`]([A-Z][A-Z0-9]+-[A-Z0-9_-]+)["'`]/g;
const DOCUMENTED_ID_PATTERN = /^`([A-Z][A-Z0-9]+-[A-Z0-9_-]+)`$/;

test("all implemented scan finding identifiers are documented", async () => {
  const implementedIds = await collectImplementedFindingIds();
  const diagnostics = await readFile(
    path.join(process.cwd(), "docs", "diagnostics.md"),
    "utf8",
  );
  const documentedIds = collectDocumentedFindingIds(
    scanFindingIdentifiersSection(diagnostics),
  );

  assert.ok(
    implementedIds.length > 0,
    "expected to find implemented scan finding identifiers",
  );
  assert.ok(
    documentedIds.length > 0,
    "expected docs/diagnostics.md to contain a Scan Finding Identifiers table",
  );

  const documented = new Set(documentedIds);
  const missing = implementedIds.filter((id) => !documented.has(id));
  const implemented = new Set(implementedIds);
  const stale = documentedIds.filter((id) => !implemented.has(id));

  if (missing.length > 0) {
    assert.fail(
      [
        "docs/diagnostics.md is missing implemented scan finding identifier(s)",
        "from the Scan Finding Identifiers table:",
        ...missing.map((id) => `- ${id}`),
      ].join("\n"),
    );
  }

  if (stale.length > 0) {
    assert.fail(
      [
        "docs/diagnostics.md documents scan finding identifier(s) that are not",
        "emitted by the current implementation:",
        ...stale.map((id) => `- ${id}`),
      ].join("\n"),
    );
  }
});

async function collectImplementedFindingIds(): Promise<string[]> {
  const ids = new Set<string>();

  for (const file of SCAN_FINDING_IMPLEMENTATION_FILES) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    for (const match of source.matchAll(FINDING_ID_PATTERN)) {
      const id = match[1];
      if (id) ids.add(id);
    }
  }

  return [...ids].sort();
}

function scanFindingIdentifiersSection(diagnostics: string): string {
  const heading = "## Scan Finding Identifiers";
  const start = diagnostics.indexOf(heading);

  assert.notEqual(
    start,
    -1,
    "docs/diagnostics.md must contain a Scan Finding Identifiers section",
  );

  const bodyStart = start + heading.length;
  const nextHeading = diagnostics.slice(bodyStart).search(/\n## /);

  return nextHeading === -1
    ? diagnostics.slice(bodyStart)
    : diagnostics.slice(bodyStart, bodyStart + nextHeading);
}

function collectDocumentedFindingIds(section: string): string[] {
  const ids = new Set<string>();
  const tableLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  assert.ok(
    tableLines.length >= 3,
    "Scan Finding Identifiers section must contain a markdown table",
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
