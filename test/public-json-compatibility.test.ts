import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { catalog, formatCatalogJson } from "../src/commands/catalog.js";

const FIXTURE_ROOT = path.resolve("test/fixtures/public-json-baseline");
const EXPECTED_ROOT = path.resolve("test/fixtures/public-json-expected");

const BASELINE_CASES = [
  {
    name: "scan",
    argv: ["scan", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    name: "catalog",
    argv: ["catalog", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    name: "graph",
    argv: ["graph", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    name: "skill-index",
    argv: ["skill-index", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    name: "readiness",
    argv: ["readiness", FIXTURE_ROOT, "--format", "json"],
    code: 1,
  },
  {
    name: "bom",
    argv: ["bom", FIXTURE_ROOT, "--format", "json", "--omit-generated-at"],
    code: 0,
  },
] as const;

test("representative public JSON matches fixed 0.22.5 baselines", async () => {
  const outputs = new Map<string, string>();

  for (const item of BASELINE_CASES) {
    const expected = await readFile(
      path.join(EXPECTED_ROOT, `${item.name}.golden`),
      "utf8",
    );
    const actual = await captureProcessOutput(() => main([...item.argv]));
    const normalizedStdout = actual.stdout.replaceAll(FIXTURE_ROOT, "<ROOT>");

    assert.equal(actual.code, item.code, `${item.name} exit code`);
    assert.equal(actual.stderr, "", `${item.name} stderr`);
    assert.equal(normalizedStdout, expected, `${item.name} stdout`);
    outputs.set(item.name, normalizedStdout);
  }

  const catalogOutput = parseOutput(outputs, "catalog");
  const catalogDiagnostics = arrayOfRecords(catalogOutput.diagnostics);
  assert.ok(
    catalogDiagnostics.some(
      (diagnostic) => diagnostic.message === "Asset is missing an owner.",
    ),
  );
  assert.ok(catalogDiagnostics.every((diagnostic) => !("code" in diagnostic)));

  const scanOutput = parseOutput(outputs, "scan");
  const findingIds = arrayOfRecords(scanOutput.findings).map(
    (finding) => finding.id,
  );
  assert.ok(findingIds.includes("META-INVALID-STATUS"));
  assert.ok(findingIds.includes("META-CONTEXT-MISSING-WHEN-TO-USE"));
  assert.ok(findingIds.includes("META-CONTEXT-PLACEHOLDER-USAGE-BOUNDARY"));
  assert.ok(findingIds.includes("META-UNKNOWN-DEPENDENCY"));
  assert.ok(findingIds.includes("MAINT-REFERENCE-DEPRECATED-ASSET"));
  assert.ok(
    arrayOfRecords(scanOutput.findings).every(
      (finding) =>
        record(finding.evidence).path !== "contexts/missing-owner.md",
    ),
  );

  const diagnosticV2Codes = arrayOfRecords(scanOutput.diagnosticsV2).map(
    (diagnostic) => diagnostic.code,
  );
  for (const findingId of findingIds) {
    assert.ok(diagnosticV2Codes.includes(findingId), String(findingId));
  }
});

test("CLI JSON output matches direct command serialization", async () => {
  const expected = formatCatalogJson(await catalog(FIXTURE_ROOT));
  const actual = await captureProcessOutput(() =>
    main(["catalog", FIXTURE_ROOT, "--format", "json"]),
  );

  assert.equal(actual.code, 0);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdout, expected);
});

function parseOutput(
  outputs: ReadonlyMap<string, string>,
  name: string,
): Record<string, unknown> {
  return record(JSON.parse(outputs.get(name) ?? "null"));
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function captureProcessOutput(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
