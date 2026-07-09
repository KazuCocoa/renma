import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import packageJson from "../package.json" with { type: "json" };
import { main } from "../src/cli.js";
import {
  bom,
  formatBomJson,
  formatBomMarkdown,
  type BomReport,
} from "../src/commands/bom.js";

test("bom report declares Repository Context BOM schema and scope", async () => {
  const report = await bom(await bomFixture());

  assert.equal(report.schemaVersion, "renma.repository-context-bom.v1");
  assert.equal(report.generator.name, "renma");
  assert.equal(report.generator.version, packageJson.version);
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(path.isAbsolute(report.root), true);
  assert.deepEqual(report.scope, {
    type: "declared_repository_manifest",
    runtimeUsage: false,
    telemetryCollected: false,
  });

  const parsed = JSON.parse(formatBomJson(report)) as BomReport;
  assert.equal(parsed.schemaVersion, "renma.repository-context-bom.v1");
  assert.equal(parsed.scope.runtimeUsage, false);
  assert.equal(parsed.scope.telemetryCollected, false);
});

test("bom assets include catalog metadata and lifecycle evidence", async () => {
  const report = await bom(await bomFixture());
  const asset = report.assets.find(
    (candidate) => candidate.id === "context.testing.boundary-value-analysis",
  );

  assert.ok(asset);
  assert.equal(asset.kind, "context");
  assert.equal(asset.sourcePath, "contexts/testing/boundary-value-analysis.md");
  assert.match(asset.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(asset.owner, "qa-platform");
  assert.equal(asset.status, "stable");
  assert.equal(asset.version, "1.0.0");
  assert.deepEqual(asset.tags, ["testing"]);
  assert.deepEqual(asset.lifecycle, {
    status: "stable",
    lastReviewedAt: "2026-06-28",
    reviewCycle: "P180D",
    expiresAt: "2026-12-31",
  });
});

test("bom dependencies include resolved target evidence and unresolved edges", async () => {
  const report = await bom(await bomFixture());
  const resolved = report.dependencies.find(
    (dependency) =>
      dependency.from === "skill.testing.spec-review" &&
      dependency.to === "context.testing.boundary-value-analysis",
  );
  const unresolved = report.dependencies.find(
    (dependency) =>
      dependency.from === "skill.testing.spec-review" &&
      dependency.to === "context.testing.missing",
  );
  const context = report.assets.find(
    (asset) => asset.id === "context.testing.boundary-value-analysis",
  );
  const skill = report.assets.find(
    (asset) => asset.id === "skill.testing.spec-review",
  );

  assert.deepEqual(resolved, {
    from: "skill.testing.spec-review",
    to: "context.testing.boundary-value-analysis",
    kind: "requires",
    sourcePath: "skills/testing/spec-review/SKILL.md",
    resolved: true,
    targetId: "context.testing.boundary-value-analysis",
    targetKind: "context",
    targetPath: "contexts/testing/boundary-value-analysis.md",
  });
  assert.deepEqual(unresolved, {
    from: "skill.testing.spec-review",
    to: "context.testing.missing",
    kind: "requires",
    sourcePath: "skills/testing/spec-review/SKILL.md",
    resolved: false,
  });
  assert.deepEqual(context?.dependents, [
    {
      kind: "requires",
      from: "skill.testing.spec-review",
      sourcePath: "skills/testing/spec-review/SKILL.md",
    },
  ]);
  assert.equal(
    skill?.dependencies.some(
      (dependency) =>
        dependency.to === "context.testing.boundary-value-analysis" &&
        dependency.resolved &&
        dependency.targetKind === "context",
    ),
    true,
  );
  assert.equal(
    report.summary.resolvedDependencyCount,
    report.dependencies.filter((dependency) => dependency.resolved).length,
  );
  assert.equal(report.summary.unresolvedDependencyCount, 1);
});

test("bom includes readiness, security posture, and policy inventory evidence", async () => {
  const report = await bom(await bomFixture());

  assert.equal(report.readiness.score, report.summary.readinessScore);
  assert.equal(report.readiness.level, report.summary.readinessLevel);
  assert.ok(report.readiness.checks.length > 0);
  assert.equal(report.readiness.summary.totalAssets, report.summary.assetCount);
  assert.equal(
    report.securityPosture,
    report.readiness.summary.securityPosture,
  );
  assert.equal(
    report.securityPolicyInventory,
    report.readiness.summary.securityPolicyInventory,
  );
});

test("bom diagnostics include deduped catalog and graph warnings", async () => {
  const report = await bom(await catalogWarningFixture());
  const warnings = report.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "warning" &&
      /Metadata dependency "context\.testing\.missing"/.test(
        diagnostic.message,
      ),
  );

  assert.equal(report.readiness.level, "ready");
  assert.equal(warnings.length, 1);
  assert.equal(report.summary.diagnosticCounts.warning, 1);
  assert.deepEqual(report.summary.diagnosticCounts, {
    error: report.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length,
    warning: report.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length,
    info: report.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "info",
    ).length,
  });
});

test("bom markdown is a compact human-review report", async () => {
  const markdown = formatBomMarkdown(await bom(await bomFixture()));

  assert.match(markdown, /^# Repository Context BOM/m);
  assert.match(markdown, /- Runtime usage: no/);
  assert.match(markdown, /- Telemetry collected: no/);
  assert.match(
    markdown,
    /\| ID \| Kind \| Source \| Hash \| Owner \| Status \| Dependencies \|/,
  );
  assert.match(markdown, /^## Readiness Evidence$/m);
  assert.match(markdown, /- Workflow readiness: /);
  assert.match(markdown, /^## Security Policy Inventory$/m);
  assert.match(markdown, /\| Policy assets \| 2 \|/);
  assert.match(markdown, /\| Assets missing policy metadata \| 2 \|/);
  assert.match(markdown, /\| Network unspecified \| 2 \|/);
});

test("bom CLI supports JSON and Markdown formats", async () => {
  const root = await bomFixture();

  const defaultJson = await withCapturedConsole(() => main(["bom", root]));
  const explicitJson = await withCapturedConsole(() =>
    main(["bom", root, "--format", "json"]),
  );
  const markdown = await withCapturedConsole(() =>
    main(["bom", root, "--format", "markdown"]),
  );
  const jsonShortcut = await withCapturedConsole(() =>
    main(["bom", root, "--json"]),
  );

  assert.equal(defaultJson.code, 0);
  assert.equal(
    JSON.parse(defaultJson.stdout).schemaVersion,
    "renma.repository-context-bom.v1",
  );
  assert.equal(explicitJson.code, 0);
  assert.equal(JSON.parse(explicitJson.stdout).scope.runtimeUsage, false);
  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /^# Repository Context BOM/m);
  assert.equal(jsonShortcut.code, 0);
  assert.equal(JSON.parse(jsonShortcut.stdout).scope.telemetryCollected, false);
});

test("bom CLI rejects unsupported format", async () => {
  const root = await fixture();

  const result = await withCapturedConsole(() =>
    main(["bom", root, "--format", "text"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either json or markdown/);
});

test("bom CLI exits 1 when generated report contains error diagnostics", async () => {
  const root = await fixture();
  await writeBrokenLens(root);

  const result = await withCapturedConsole(() => main(["bom", root]));
  const parsed = JSON.parse(result.stdout) as BomReport;

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

async function bomFixture(): Promise<string> {
  const root = await fixture();
  await writeSkill(root);
  await writeContext(root, {
    id: "context.testing.boundary-value-analysis",
    fileName: "boundary-value-analysis",
    owner: "qa-platform",
    status: "stable",
    version: "1.0.0",
    tags: ["testing"],
    lastReviewedAt: "2026-06-28",
    reviewCycle: "P180D",
    expiresAt: "2026-12-31",
  });
  return root;
}

async function catalogWarningFixture(): Promise<string> {
  const root = await fixture();
  await writeOptionalMissingSkill(root);
  return root;
}

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-"));
}

async function writeSkill(root: string): Promise<void> {
  await mkdir(path.join(root, "skills", "testing", "spec-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "spec-review", "SKILL.md"),
    [
      "---",
      "id: skill.testing.spec-review",
      "owner: qa-platform",
      "status: stable",
      "tags: testing",
      "requires_context:",
      "  - context.testing.boundary-value-analysis",
      "  - context.testing.missing",
      "---",
      "# Spec Review",
      "",
      "## When to use",
      "Use this workflow for deterministic Repository Context BOM tests.",
      "",
      "## Required inputs",
      "Required inputs: repository root and the requested BOM output format.",
      "",
      "## DO NOT USE FOR",
      "Do not use this workflow for runtime task context selection or prompt assembly.",
      "",
      "## Preflight",
      "Confirm the repository fixture exists and inputs are static.",
      "",
      "## Example",
      "Input: BOM fixture. Output: deterministic manifest evidence.",
      "",
      "## Completion criteria",
      "The workflow is complete when BOM output contains catalog, graph, and readiness evidence.",
      "",
      "## Verification",
      "Verify by running the BOM command and checking JSON or Markdown output.",
      "",
    ].join("\n"),
  );
}

async function writeOptionalMissingSkill(root: string): Promise<void> {
  await mkdir(path.join(root, "skills", "testing", "optional-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "optional-review", "SKILL.md"),
    [
      "---",
      "id: skill.testing.optional-review",
      "owner: qa-platform",
      "status: stable",
      "optional_context:",
      "  - context.testing.missing",
      "---",
      "# Optional Review",
      "",
      "## When to use",
      "Use this workflow for deterministic Repository Context BOM diagnostic tests.",
      "",
      "## Required inputs",
      "Required inputs: repository root and the requested BOM output format.",
      "",
      "## DO NOT USE FOR",
      "Do not use this workflow for runtime task context selection or prompt assembly.",
      "",
      "## Preflight",
      "Confirm the repository fixture exists and inputs are static.",
      "",
      "## Example",
      "Input: BOM fixture. Output: deterministic manifest evidence.",
      "",
      "## Completion criteria",
      "The workflow is complete when BOM output contains deduped diagnostics.",
      "",
      "## Verification",
      "Verify by running the BOM command and checking JSON or Markdown output.",
      "",
    ].join("\n"),
  );
}

async function writeContext(
  root: string,
  metadata: {
    id: string;
    fileName: string;
    owner: string;
    status: string;
    version: string;
    tags: string[];
    lastReviewedAt: string;
    reviewCycle: string;
    expiresAt: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", `${metadata.fileName}.md`),
    [
      "---",
      `id: ${metadata.id}`,
      `owner: ${metadata.owner}`,
      `status: ${metadata.status}`,
      `version: ${metadata.version}`,
      `tags: ${metadata.tags.join(", ")}`,
      `last_reviewed_at: ${metadata.lastReviewedAt}`,
      `review_cycle: ${metadata.reviewCycle}`,
      `expires_at: ${metadata.expiresAt}`,
      "when_to_use: Review testing boundaries for deterministic BOM fixtures.",
      "when_not_to_use: Do not use as runtime prompt assembly instructions.",
      "---",
      "# Boundary Value Analysis",
      "",
      "Use this shared context for static report tests.",
      "",
    ].join("\n"),
  );
}

async function writeBrokenLens(root: string): Promise<void> {
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "lenses", "testing", "broken.md"),
    [
      "---",
      "id: lens.testing.broken",
      "owner: qa-platform",
      "---",
      "# Broken Lens",
      "",
      "This fixture intentionally omits required lens fields.",
      "",
    ].join("\n"),
  );
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
