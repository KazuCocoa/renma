import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import {
  formatReadinessMarkdown,
  readiness,
  type ReadinessReport,
  type ReadinessCheckStatus,
} from "../src/commands/readiness.js";

test("readiness report marks fully owned resolved inventory ready", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    requiresContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "stable",
  });

  const report = await readiness(root);

  assert.equal(report.score, 100);
  assert.equal(report.level, "ready");
  assert.equal(report.summary.totalAssets, 2);
  assert.equal(report.summary.ownedAssets, 2);
  assert.equal(report.summary.unownedAssets, 0);
  assert.equal(report.summary.ownershipCoveragePercent, 100);
  assert.equal(report.summary.edgeCount, 1);
  assert.equal(report.summary.resolvedEdges, 1);
  assert.equal(report.summary.unresolvedEdges, 0);
  assert.equal(report.summary.graphResolutionPercent, 100);
  assertCheckStatuses(report, {
    "diagnostics.errors": "pass",
    "ownership.coverage": "pass",
    "graph.unresolved_edges": "pass",
    "assets.lifecycle": "pass",
    "assets.minimum_inventory": "pass",
    "layout.skills_thin": "pass",
    "layout.disallowed_skill_assets": "pass",
    "paths.helper_commands": "pass",
  });
});

test("readiness report scores unresolved and unowned assets deterministically", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    status: "archived",
    requiresContext: ["missing.context"],
  });

  const report = await readiness(root);

  assert.equal(report.score, 45);
  assert.equal(report.level, "not_ready");
  assert.equal(report.summary.totalAssets, 1);
  assert.equal(report.summary.ownedAssets, 0);
  assert.equal(report.summary.unownedAssets, 1);
  assert.equal(report.summary.unresolvedEdges, 1);
  assert.equal(report.summary.diagnosticCounts.error, 0);
  assertCheckStatuses(report, {
    "diagnostics.errors": "pass",
    "ownership.coverage": "warn",
    "graph.unresolved_edges": "fail",
    "assets.lifecycle": "warn",
    "assets.minimum_inventory": "pass",
    "layout.skills_thin": "pass",
    "layout.disallowed_skill_assets": "pass",
    "paths.helper_commands": "pass",
  });
});

test("readiness markdown prints a compact reviewable report", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { owner: "platform" });

  const markdown = formatReadinessMarkdown(await readiness(root));

  assert.match(markdown, /^# Agent Readiness/m);
  assert.match(markdown, /\| Total assets \| 1 \|/);
  assert.match(markdown, /\| ownership\.coverage \| pass \| info \|/);
});

test("readiness CLI supports --json", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { owner: "platform" });

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--json"]),
  );
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(parsed.level, "ready");
  assert.equal(parsed.summary.totalAssets, 1);
});

test("readiness CLI exits 1 for needs_attention", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {});

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--json"]),
  );
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(parsed.level, "needs_attention");
  assert.equal(parsed.summary.unownedAssets, 1);
});

test("readiness CLI exits 1 for not_ready unresolved graph edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    requiresContext: ["missing.context"],
  });

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--json"]),
  );
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(parsed.level, "not_ready");
  assert.equal(parsed.summary.unresolvedEdges, 1);
});

test("readiness CLI exits 1 for zero assets", async () => {
  const root = await fixture();

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--json"]),
  );
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(parsed.level, "not_ready");
  assert.equal(parsed.summary.totalAssets, 0);
});

test("readiness CLI exits 2 for unsupported format", async () => {
  const root = await fixture();

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--format", "text"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either json or markdown/);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-"));
}

async function writeSkill(
  root: string,
  id: string,
  metadata: {
    owner?: string;
    status?: string;
    tags?: string[];
    requiresContext?: string[];
  },
): Promise<void> {
  await mkdir(path.join(root, "skills", id), { recursive: true });
  await writeFile(
    path.join(root, "skills", id, "SKILL.md"),
    markdown({
      id,
      ...metadata,
      title: `# ${id}`,
    }),
  );
}

async function writeContext(
  root: string,
  group: string,
  id: string,
  metadata: { owner?: string; status?: string; tags?: string[] },
): Promise<void> {
  await mkdir(path.join(root, "contexts", group), { recursive: true });
  await writeFile(
    path.join(root, "contexts", group, `${id}.md`),
    markdown({
      id: `${group}.${id}`,
      ...metadata,
      title: `# ${id}`,
    }),
  );
}

function markdown(metadata: {
  id: string;
  owner?: string;
  status?: string;
  tags?: string[];
  requiresContext?: string[];
  title: string;
}): string {
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.tags ? [`tags: ${metadata.tags.join(", ")}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
      : []),
    "---",
    metadata.title,
    "Use for readiness report tests.",
    "",
  ].join("\n");
}

function assertCheckStatuses(
  report: ReadinessReport,
  expected: Record<string, ReadinessCheckStatus>,
): void {
  const statuses = new Map(
    report.checks.map((check) => [check.id, check.status]),
  );
  for (const [id, status] of Object.entries(expected)) {
    assert.equal(statuses.get(id), status, id);
  }
}

async function withCapturedConsole(
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
    const code = await callback();
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
