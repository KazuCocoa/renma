import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../src/cli.js";
import { bom, formatBomJson } from "../src/commands/bom.js";
import { catalog, formatCatalogJson } from "../src/commands/catalog.js";
import { formatGraphJson, graph } from "../src/commands/graph.js";
import {
  buildSkillIndexReport,
  formatSkillIndexJson,
} from "../src/commands/skill-index.js";
import { formatReadinessJson, readiness } from "../src/commands/readiness.js";
import { formatJson as formatScanJson } from "../src/report.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scan } from "../src/scanner.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("representative JSON command bytes match their established public serializers", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("review", {
    id: "skill.review",
    owner: "qa",
    status: "stable",
  });
  await fixture.context("contexts/reference.md", {
    id: "context.reference",
    owner: "qa",
    status: "stable",
    whenToUse: ["repository review"],
    whenNotToUse: ["runtime selection"],
  });

  const cases: readonly {
    name: string;
    argv: string[];
    expected(): Promise<string>;
  }[] = [
    {
      name: "scan",
      argv: ["scan", fixture.root, "--format", "json"],
      expected: async () =>
        formatScanJson(await scan(fixture.root, { format: "json" })),
    },
    {
      name: "catalog",
      argv: ["catalog", fixture.root, "--format", "json"],
      expected: async () => formatCatalogJson(await catalog(fixture.root)),
    },
    {
      name: "graph",
      argv: ["graph", fixture.root, "--format", "json"],
      expected: async () => formatGraphJson(await graph(fixture.root)),
    },
    {
      name: "skill-index",
      argv: ["skill-index", fixture.root, "--format", "json"],
      expected: async () =>
        formatSkillIndexJson(
          buildSkillIndexReport(await collectRepositorySnapshot(fixture.root)),
        ),
    },
    {
      name: "readiness",
      argv: ["readiness", fixture.root, "--format", "json"],
      expected: async () => formatReadinessJson(await readiness(fixture.root)),
    },
    {
      name: "bom",
      argv: ["bom", fixture.root, "--format", "json", "--omit-generated-at"],
      expected: async () =>
        formatBomJson(await bom(fixture.root, {}, { omitGeneratedAt: true })),
    },
  ];

  for (const item of cases) {
    const expected = await item.expected();
    const actual = await captureProcessOutput(() => main(item.argv));
    assert.equal(actual.stderr, "", item.name);
    assert.equal(actual.stdout, expected, item.name);
  }
});

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
