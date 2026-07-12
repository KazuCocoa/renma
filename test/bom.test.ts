import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import packageJson from "../package.json" with { type: "json" };
import { main } from "../src/cli.js";
import {
  bom,
  buildBomReport,
  formatBomJson,
  formatBomMarkdown,
  type BomReport,
} from "../src/commands/bom.js";
import {
  graphFromRepositoryEvidence,
  graphFromRepositorySnapshot,
} from "../src/commands/graph.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  collectRepositoryEvidence,
  collectRepositorySnapshot,
} from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import type { ScanResult } from "../src/types.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

test("bom report declares Repository Context BOM schema and scope", async () => {
  const report = await bom(await bomFixture());

  assert.equal(report.schemaVersion, "renma.repository-context-bom.v1");
  assert.equal(report.outputMode, "default");
  assert.equal(report.generator.name, "renma");
  assert.equal(report.generator.version, packageJson.version);
  assert.ok(report.generatedAt);
  assert.match(
    report.generatedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(path.isAbsolute(report.root), true);
  assert.deepEqual(report.scope, {
    type: "declared_repository_manifest",
    runtimeUsage: false,
    telemetryCollected: false,
  });

  const parsed = JSON.parse(formatBomJson(report)) as BomReport;
  assert.equal(parsed.schemaVersion, "renma.repository-context-bom.v1");
  assert.equal(parsed.outputMode, "default");
  assert.equal(parsed.scope.runtimeUsage, false);
  assert.equal(parsed.scope.telemetryCollected, false);
});

test("bom v1 normalized contract shape is stable", async () => {
  const report = buildBomReport(
    await collectRepositorySnapshot(await bomContractFixture()),
    {
      generatedAt: new Date("2026-07-10T12:00:00.000Z"),
      evaluationDate: "2026-07-10",
    },
  );

  assert.equal(
    JSON.stringify(normalizeBomContract(report), null, 2),
    JSON.stringify(expectedBomContract(), null, 2),
  );
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

test("bom uses shared repository evidence for assets and dependencies", async () => {
  const root = await bomFixture();
  const evidence = await collectRepositoryEvidence(root);
  const graphReport = graphFromRepositoryEvidence(evidence);
  const report = await bom(root, {}, { omitGeneratedAt: true });

  assert.deepEqual(
    report.assets.map((asset) => [
      asset.id,
      asset.kind,
      asset.sourcePath,
      asset.contentHash,
    ]),
    evidence.catalog.assets
      .toSorted(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.id.localeCompare(right.id),
      )
      .map((asset) => [
        asset.id,
        asset.kind,
        asset.sourcePath,
        asset.contentHash,
      ]),
  );
  assert.deepEqual(
    report.dependencies.map((dependency) => [
      dependency.from,
      dependency.kind,
      dependency.to,
      dependency.sourcePath,
      dependency.resolved,
      dependency.targetId,
      dependency.targetPath,
    ]),
    graphReport.edges
      .toSorted(
        (left, right) =>
          left.from.localeCompare(right.from) ||
          left.kind.localeCompare(right.kind) ||
          left.to.localeCompare(right.to) ||
          left.sourcePath.localeCompare(right.sourcePath),
      )
      .map((edge) => [
        edge.from,
        edge.kind,
        edge.to,
        edge.sourcePath,
        edge.resolved,
        edge.targetId,
        edge.targetPath,
      ]),
  );
});

test("bom report builder does not rediscover files after snapshot collection", async () => {
  const root = await bomFixture();
  const snapshot = await collectRepositorySnapshot(root);
  const options = {
    omitGeneratedAt: true,
    evaluationDate: "2026-07-10",
  } as const;
  const report = buildBomReport(snapshot, options);
  const graphReport = graphFromRepositorySnapshot(snapshot);

  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    [
      "---",
      "id: context.testing.changed-after-snapshot",
      "owner: changed-owner",
      "status: deprecated",
      "expires_at: 2000-01-01",
      "---",
      "# Changed After Snapshot",
      "",
      "token = super-secret-token-value",
      "",
    ].join("\n"),
  );

  assert.deepEqual(buildBomReport(snapshot, options), report);
  assert.deepEqual(
    await bom(root, {}, { omitGeneratedAt: true }),
    buildBomReport(await collectRepositorySnapshot(root), {
      omitGeneratedAt: true,
    }),
  );
  assert.equal(report.summary.assetCount, snapshot.catalog.assets.length);
  assert.equal(
    report.readiness.summary.totalAssets,
    snapshot.catalog.assets.length,
  );
  assert.equal(report.summary.dependencyCount, graphReport.edges.length);
  assert.equal(report.readiness.summary.edgeCount, graphReport.edgeCount);
  assert.equal(
    report.summary.resolvedDependencyCount,
    graphReport.edges.filter((edge) => edge.resolved).length,
  );
  assert.equal(
    report.summary.unresolvedDependencyCount,
    graphReport.edges.filter((edge) => !edge.resolved).length,
  );
  assert.equal(
    report.assets.some(
      (asset) => asset.id === "context.testing.changed-after-snapshot",
    ),
    false,
  );
  assert.equal(
    report.securityPosture.totalSecurityFindings,
    report.readiness.summary.securityPosture.totalSecurityFindings,
  );
});

test("snapshot path evidence keeps helper command missing when target is created later", async () => {
  const root = await helperCommandPathFixture({ helperExists: false });
  const snapshot = await collectRepositorySnapshot(root);

  await writeHelperScript(root);

  const staleScan = scanFromRepositorySnapshot(snapshot);
  const freshScan = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
  );
  const staleBom = buildBomReport(snapshot, { omitGeneratedAt: true });

  assert.equal(
    hasScanFinding(staleScan, DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED),
    true,
  );
  assert.equal(
    hasScanFinding(freshScan, DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED),
    false,
  );
  assert.equal(
    hasReadinessEvidence(
      staleBom,
      "paths.helper_commands",
      DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED,
    ),
    true,
  );
});

test("snapshot path evidence keeps helper command resolved when target is removed later", async () => {
  const root = await helperCommandPathFixture({ helperExists: true });
  const snapshot = await collectRepositorySnapshot(root);

  await unlink(helperScriptPath(root));

  const staleScan = scanFromRepositorySnapshot(snapshot);
  const freshScan = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
  );

  assert.equal(
    hasScanFinding(staleScan, DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED),
    false,
  );
  assert.equal(
    hasScanFinding(freshScan, DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED),
    true,
  );
});

test("snapshot path evidence keeps declared dependency missing when target is created later", async () => {
  const root = await declaredDependencyPathFixture({ targetExists: false });
  const snapshot = await collectRepositorySnapshot(root);

  await writeDeclaredDependencyTarget(root);

  const staleScan = scanFromRepositorySnapshot(snapshot);
  const freshScan = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
  );

  assert.equal(
    hasScanFinding(
      staleScan,
      DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
    ),
    false,
  );
  assert.equal(
    hasScanFinding(
      freshScan,
      DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
    ),
    true,
  );
});

test("snapshot path evidence keeps declared dependency present when target is removed later", async () => {
  const root = await declaredDependencyPathFixture({ targetExists: true });
  const snapshot = await collectRepositorySnapshot(root);

  await unlink(declaredDependencyTargetPath(root));

  const staleScan = scanFromRepositorySnapshot(snapshot);
  const freshScan = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
  );

  assert.equal(
    hasScanFinding(
      staleScan,
      DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
    ),
    true,
  );
  assert.equal(
    hasScanFinding(
      freshScan,
      DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
    ),
    false,
  );
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

test("bom markdown escapes repository-derived table cells", async () => {
  const report = await bom(await markdownEscapingFixture());
  report.readiness.checks = report.readiness.checks.map((check, index) =>
    index === 0 ? { ...check, summary: "readiness|summary" } : check,
  );
  const markdown = formatBomMarkdown(report);

  assert.match(
    markdown,
    /context\.testing\.pipe \| context \| contexts\/pipe\\\|dir\/boundary\.md/,
  );
  assert.match(markdown, /qa\\\|platform/);
  assert.match(
    markdown,
    /\| skill\.testing\.pipe \| requires \| context\.testing\.missing\\\|pipe \| skills\/pipe-skill\/SKILL\.md \|/,
  );
  assert.match(markdown, /readiness\\\|summary/);
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

test("bom CLI generatedAt omission JSON output is reproducible", async () => {
  const root = await bomFixture();

  const first = await withCapturedConsole(() =>
    main(["bom", root, "--json", "--omit-generated-at"]),
  );
  const second = await withCapturedConsole(() =>
    main(["bom", root, "--json", "--omit-generated-at"]),
  );

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.equal(first.stderr, "");
  assert.equal(second.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const parsed = JSON.parse(first.stdout) as BomReport;
  const asset = parsed.assets.find(
    (candidate) => candidate.id === "context.testing.boundary-value-analysis",
  );
  assert.equal(parsed.outputMode, "omit_generated_at");
  assert.equal("generatedAt" in parsed, false);
  assert.equal(asset?.lifecycle?.lastReviewedAt, "2026-06-28");
  assert.equal(asset?.lifecycle?.expiresAt, "2026-12-31");
});

test("bom --omit-generated-at keeps absolute roots environment-dependent", async () => {
  const first = formatBomJson(
    await bom(await bomFixture(), {}, { omitGeneratedAt: true }),
  );
  const second = formatBomJson(
    await bom(await bomFixture(), {}, { omitGeneratedAt: true }),
  );
  const firstReport = JSON.parse(first) as BomReport;
  const secondReport = JSON.parse(second) as BomReport;

  assert.equal(path.isAbsolute(firstReport.root), true);
  assert.equal(path.isAbsolute(secondReport.root), true);
  assert.notEqual(firstReport.root, secondReport.root);
  assert.notEqual(first, second);
});

test("bom treats file moves as meaningful sourcePath changes", async () => {
  const root = await bomFixture();
  const before = await bom(root, {}, { omitGeneratedAt: true });

  await mkdir(path.join(root, "contexts", "renamed"), { recursive: true });
  await rename(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    path.join(root, "contexts", "renamed", "boundary-value-analysis.md"),
  );

  const after = await bom(root, {}, { omitGeneratedAt: true });
  const beforeAsset = before.assets.find(
    (asset) => asset.id === "context.testing.boundary-value-analysis",
  );
  const afterAsset = after.assets.find(
    (asset) => asset.id === "context.testing.boundary-value-analysis",
  );

  assert.equal(
    beforeAsset?.sourcePath,
    "contexts/testing/boundary-value-analysis.md",
  );
  assert.equal(
    afterAsset?.sourcePath,
    "contexts/renamed/boundary-value-analysis.md",
  );
  assert.notEqual(formatBomJson(before), formatBomJson(after));
});

test("bom freshness diagnostics use a controlled UTC evaluation date", async () => {
  const root = await fixture();
  await writeContext(root, {
    id: "context.testing.freshness-boundary",
    fileName: "freshness-boundary",
    owner: "qa-platform",
    status: "stable",
    version: "1.0.0",
    tags: ["testing"],
    lastReviewedAt: "2026-01-01",
    reviewCycle: "P1D",
    expiresAt: "2026-12-31",
  });
  const snapshot = await collectRepositorySnapshot(root);

  const dueDay = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: "2026-01-02",
  });
  const afterDueDay = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: "2026-01-03",
  });

  assert.equal(
    hasDiagnosticFinding(dueDay, "MAINT-ASSET-REVIEW-OVERDUE"),
    false,
  );
  assert.equal(
    hasDiagnosticFinding(afterDueDay, "MAINT-ASSET-REVIEW-OVERDUE"),
    true,
  );
});

test("bom evaluation date uses the UTC calendar day", async () => {
  const root = await fixture();
  await writeContext(root, {
    id: "context.testing.utc-boundary",
    fileName: "utc-boundary",
    owner: "qa-platform",
    status: "stable",
    version: "1.0.0",
    tags: ["testing"],
    lastReviewedAt: "2026-07-09",
    reviewCycle: "P30D",
    expiresAt: "2026-07-09",
  });
  const snapshot = await collectRepositorySnapshot(root);
  const report = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: new Date("2026-07-10T00:30:00.000Z"),
  });

  assert.equal(hasDiagnosticFinding(report, "MAINT-ASSET-EXPIRED"), true);
});

test("bom CLI generatedAt omission Markdown output says generatedAt was omitted", async () => {
  const root = await bomFixture();

  const result = await withCapturedConsole(() =>
    main(["bom", root, "--format", "markdown", "--omit-generated-at"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /- Output mode: omit_generated_at/);
  assert.match(result.stdout, /- Generated at: \(omitted\)/);
  assert.doesNotMatch(result.stdout, /1970-01-01T00:00:00\.000Z/);
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

async function bomContractFixture(): Promise<string> {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "testing", "contract-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "contract-review", "SKILL.md"),
    canonicalSkillFixture(
      "skills/testing/contract-review/SKILL.md",
      [
        "---",
        "id: skill.testing.contract-review",
        "owner: qa-platform",
        "status: stable",
        "tags: testing",
        "requires_context:",
        "  - context.testing.contract",
        "allowed_data: repository test fixtures only",
        "network_allowed: false",
        "external_upload_allowed: false",
        "secrets_allowed: false",
        "requires_human_approval: true",
        "---",
        "# Contract Review",
        "",
        "## When to use",
        "Use this workflow for deterministic Repository Context BOM contract tests.",
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
        "The workflow is complete when BOM output contains the expected v1 contract shape.",
        "",
        "## Verification",
        "Verify by running the BOM command and checking JSON output.",
        "",
      ].join("\n"),
    ),
  );
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "contract.md"),
    [
      "---",
      "id: context.testing.contract",
      "owner: qa-platform",
      "status: stable",
      "version: 1.0.0",
      "tags: testing",
      "last_reviewed_at: 2026-06-28",
      "review_cycle: P180D",
      "expires_at: 2026-12-31",
      "when_to_use: Review BOM v1 contract shape in deterministic fixtures.",
      "when_not_to_use: Do not use as runtime prompt assembly instructions.",
      "allowed_data: repository test fixtures only",
      "network_allowed: false",
      "external_upload_allowed: false",
      "secrets_allowed: false",
      "requires_human_approval: true",
      "---",
      "# Contract Context",
      "",
      "Use this shared context for static report tests.",
      "",
    ].join("\n"),
  );
  return root;
}

async function catalogWarningFixture(): Promise<string> {
  const root = await fixture();
  await writeOptionalMissingSkill(root);
  return root;
}

async function helperCommandPathFixture(options: {
  helperExists: boolean;
}): Promise<string> {
  const root = await fixture();
  await writeSnapshotPathConfig(root);
  await mkdir(path.join(root, "skills", "testing", "helper-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "helper-review", "SKILL.md"),
    canonicalSkillFixture(
      "skills/testing/helper-review/SKILL.md",
      [
        "---",
        "id: skill.testing.helper-review",
        "owner: qa-platform",
        "status: stable",
        "---",
        "# Helper Review",
        "",
        "## When to use",
        "Use this workflow for deterministic Repository Context BOM helper path tests.",
        "",
        "## Required inputs",
        "Required inputs: repository root and static helper path evidence.",
        "",
        "## DO NOT USE FOR",
        "Do not use this workflow for runtime task context selection or prompt assembly.",
        "",
        "## Preflight",
        "Confirm the repository fixture exists and inputs are static.",
        "",
        "## Example",
        "Input: helper path fixture. Output: deterministic path evidence.",
        "",
        "## Completion criteria",
        "The workflow is complete when helper path evidence is snapshot based.",
        "",
        "## Verification",
        "Verify by running the BOM command and checking readiness evidence.",
        "",
        "```bash",
        "bash scripts/setup.sh",
        "```",
        "",
      ].join("\n"),
    ),
  );
  if (options.helperExists) await writeHelperScript(root);
  return root;
}

async function declaredDependencyPathFixture(options: {
  targetExists: boolean;
}): Promise<string> {
  const root = await fixture();
  await writeSnapshotPathConfig(root);
  await mkdir(path.join(root, "skills", "testing", "dependency-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "dependency-review", "SKILL.md"),
    canonicalSkillFixture(
      "skills/testing/dependency-review/SKILL.md",
      [
        "---",
        "id: skill.testing.dependency-review",
        "owner: qa-platform",
        "status: stable",
        "requires_context:",
        "  - docs/testing/legacy-context.md",
        "---",
        "# Dependency Review",
        "",
        "## When to use",
        "Use this workflow for deterministic Repository Context BOM dependency path tests.",
        "",
        "## Required inputs",
        "Required inputs: repository root and static dependency path evidence.",
        "",
        "## DO NOT USE FOR",
        "Do not use this workflow for runtime task context selection or prompt assembly.",
        "",
        "## Preflight",
        "Confirm the repository fixture exists and inputs are static.",
        "",
        "## Example",
        "Input: dependency path fixture. Output: deterministic path evidence.",
        "",
        "## Completion criteria",
        "The workflow is complete when dependency path evidence is snapshot based.",
        "",
        "## Verification",
        "Verify by running scan and checking layout findings.",
        "",
      ].join("\n"),
    ),
  );
  if (options.targetExists) await writeDeclaredDependencyTarget(root);
  return root;
}

async function markdownEscapingFixture(): Promise<string> {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "pipe-skill"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "pipe-skill", "SKILL.md"),
    canonicalSkillFixture(
      "skills/pipe-skill/SKILL.md",
      [
        "---",
        "id: skill.testing.pipe",
        "owner: qa|platform",
        "status: stable",
        "requires_context:",
        "  - contexts/pipe|dir/boundary.md",
        "  - context.testing.missing|pipe",
        "---",
        "# Pipe Skill",
        "",
        "## When to use",
        "Use this workflow for deterministic Repository Context BOM markdown escaping tests.",
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
        "The workflow is complete when BOM markdown escapes table cells.",
        "",
        "## Verification",
        "Verify by running the BOM command and checking Markdown output.",
        "",
      ].join("\n"),
    ),
  );
  await mkdir(path.join(root, "contexts", "pipe|dir"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "pipe|dir", "boundary.md"),
    [
      "---",
      "id: context.testing.pipe",
      "owner: qa|platform",
      "status: stable",
      "when_to_use: Review markdown escaping in deterministic BOM fixtures.",
      "when_not_to_use: Do not use as runtime prompt assembly instructions.",
      "---",
      "# Pipe Context",
      "",
      "Use this shared context for static report tests.",
      "",
    ].join("\n"),
  );
  return root;
}

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-"));
}

async function writeSnapshotPathConfig(root: string): Promise<void> {
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify(
      {
        globs: ["skills/**/SKILL.md", "contexts/**/*.md"],
      },
      null,
      2,
    ),
  );
}

async function writeHelperScript(root: string): Promise<void> {
  await mkdir(path.dirname(helperScriptPath(root)), { recursive: true });
  await writeFile(helperScriptPath(root), "#!/bin/sh\nexit 0\n");
}

function helperScriptPath(root: string): string {
  return path.join(
    root,
    "skills",
    "testing",
    "helper-review",
    "scripts",
    "setup.sh",
  );
}

async function writeDeclaredDependencyTarget(root: string): Promise<void> {
  await mkdir(path.dirname(declaredDependencyTargetPath(root)), {
    recursive: true,
  });
  await writeFile(declaredDependencyTargetPath(root), "# Legacy Context\n");
}

function declaredDependencyTargetPath(root: string): string {
  return path.join(root, "docs", "testing", "legacy-context.md");
}

async function writeSkill(root: string): Promise<void> {
  await mkdir(path.join(root, "skills", "testing", "spec-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "testing", "spec-review", "SKILL.md"),
    [
      "---",
      "name: spec-review",
      "description: Use this skill for deterministic Repository Context BOM tests. Use when catalog, graph, readiness, and manifest evidence need review.",
      "metadata:",
      "  renma.id: skill.testing.spec-review",
      "  renma.owner: qa-platform",
      "  renma.status: stable",
      `  renma.tags: '["testing"]'`,
      `  renma.requires-context: '["context.testing.boundary-value-analysis","context.testing.missing"]'`,
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
      "name: optional-review",
      "description: Use this skill for deterministic Repository Context BOM diagnostic tests when optional dependency evidence needs review; do not use it for runtime routing, prompt assembly, or automatic repository edits.",
      "metadata:",
      "  renma.id: skill.testing.optional-review",
      "  renma.owner: qa-platform",
      "  renma.status: stable",
      `  renma.optional-context: '["context.testing.missing"]'`,
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

function hasDiagnosticFinding(report: BomReport, id: string): boolean {
  return (
    report.readiness.checks
      .find((check) => check.id === "assets.freshness")
      ?.evidence?.some((item) => item.id === id) === true
  );
}

function hasScanFinding(report: ScanResult, id: string): boolean {
  return report.findings.some((finding) => finding.id === id);
}

function hasReadinessEvidence(
  report: BomReport,
  checkId: string,
  findingId: string,
): boolean {
  return (
    report.readiness.checks
      .find((check) => check.id === checkId)
      ?.evidence?.some((item) => item.id === findingId) === true
  );
}

function normalizeBomContract(report: BomReport): BomReport {
  return {
    ...report,
    root: "<absolute-root>",
    ...(report.configPath ? { configPath: "<absolute-config-path>" } : {}),
    assets: report.assets.map((asset) => ({
      ...asset,
      contentHash: "<sha256>",
      sizeBytes: -1,
    })),
  };
}

function expectedBomContract(): BomReport {
  return {
    schemaVersion: "renma.repository-context-bom.v1",
    outputMode: "default",
    generatedAt: "2026-07-10T12:00:00.000Z",
    generator: {
      name: "renma",
      version: packageJson.version,
    },
    root: "<absolute-root>",
    scope: {
      type: "declared_repository_manifest",
      runtimeUsage: false,
      telemetryCollected: false,
    },
    summary: {
      scannedFileCount: 2,
      assetCount: 2,
      dependencyCount: 1,
      resolvedDependencyCount: 1,
      unresolvedDependencyCount: 0,
      ownedAssetCount: 2,
      unownedAssetCount: 0,
      readinessScore: 100,
      readinessLevel: "ready",
      diagnosticCounts: {
        error: 0,
        warning: 0,
        info: 0,
      },
    },
    assets: [
      {
        id: "context.testing.contract",
        kind: "context",
        sourcePath: "contexts/testing/contract.md",
        contentHash: "<sha256>",
        sizeBytes: -1,
        contentClassification: "text",
        markdownParserEligible: true,
        owner: "qa-platform",
        status: "stable",
        version: "1.0.0",
        tags: ["testing"],
        lifecycle: {
          status: "stable",
          lastReviewedAt: "2026-06-28",
          reviewCycle: "P180D",
          expiresAt: "2026-12-31",
        },
        dependencies: [],
        dependents: [
          {
            kind: "requires",
            from: "skill.testing.contract-review",
            sourcePath: "skills/testing/contract-review/SKILL.md",
          },
        ],
        diagnostics: [],
      },
      {
        id: "skill.testing.contract-review",
        kind: "skill",
        sourcePath: "skills/testing/contract-review/SKILL.md",
        contentHash: "<sha256>",
        sizeBytes: -1,
        contentClassification: "text",
        markdownParserEligible: true,
        owner: "qa-platform",
        status: "stable",
        tags: ["testing"],
        lifecycle: {
          status: "stable",
        },
        dependencies: [
          {
            kind: "requires",
            to: "context.testing.contract",
            resolved: true,
            targetId: "context.testing.contract",
            targetKind: "context",
            targetPath: "contexts/testing/contract.md",
          },
        ],
        dependents: [],
        diagnostics: [],
      },
    ],
    dependencies: [
      {
        from: "skill.testing.contract-review",
        to: "context.testing.contract",
        kind: "requires",
        sourcePath: "skills/testing/contract-review/SKILL.md",
        resolved: true,
        targetId: "context.testing.contract",
        targetKind: "context",
        targetPath: "contexts/testing/contract.md",
      },
    ],
    readiness: {
      score: 100,
      level: "ready",
      checks: [
        {
          id: "diagnostics.errors",
          title: "Diagnostic errors",
          status: "pass",
          severity: "info",
          summary: "No error diagnostics were reported.",
        },
        {
          id: "specification.agent_skills",
          title: "Agent Skills specification",
          status: "pass",
          severity: "info",
          summary: "1/1 Skill entrypoints pass Agent Skills validation.",
        },
        {
          id: "security.blocking",
          title: "Blocking security findings",
          status: "pass",
          severity: "info",
          summary: "No high or critical security findings were reported.",
        },
        {
          id: "ownership.coverage",
          title: "Ownership coverage",
          status: "pass",
          severity: "info",
          summary: "All cataloged assets declare an owner.",
        },
        {
          id: "graph.unresolved_edges",
          title: "Unresolved graph edges",
          status: "pass",
          severity: "info",
          summary: "All declared graph edges resolve.",
        },
        {
          id: "workflow.context_closure",
          title: "Workflow context closure",
          status: "pass",
          severity: "info",
          summary:
            "All skill required context references resolve to usable assets.",
        },
        {
          id: "workflow.optional_context",
          title: "Workflow optional context",
          status: "pass",
          severity: "info",
          summary: "No optional workflow context references were declared.",
        },
        {
          id: "workflow.clarity",
          title: "Workflow clarity",
          status: "pass",
          severity: "info",
          summary:
            "All skill workflow entrypoints include static routing clarity.",
        },
        {
          id: "workflow.required_inputs",
          title: "Workflow required inputs",
          status: "pass",
          severity: "info",
          summary:
            "All skill workflow entrypoints document required inputs or prerequisites.",
        },
        {
          id: "workflow.completion_criteria",
          title: "Workflow completion criteria",
          status: "pass",
          severity: "info",
          summary:
            "All skill workflow entrypoints document completion criteria.",
        },
        {
          id: "context_lens.governance",
          title: "Context Lens governance",
          status: "pass",
          severity: "info",
          summary: "No context lens definitions were detected.",
        },
        {
          id: "assets.lifecycle",
          title: "Asset lifecycle",
          status: "pass",
          severity: "info",
          summary: "No deprecated or archived assets were cataloged.",
        },
        {
          id: "assets.freshness",
          title: "Asset freshness",
          status: "pass",
          severity: "info",
          summary:
            "No expired, overdue, or invalid freshness metadata was found.",
        },
        {
          id: "assets.minimum_inventory",
          title: "Minimum inventory",
          status: "pass",
          severity: "info",
          summary: "2 cataloged assets found.",
        },
        {
          id: "workflow.skills_focused",
          title: "Focused skill workflows",
          status: "pass",
          severity: "info",
          summary:
            "Skill entrypoints are focused, discoverable workflows that use progressive disclosure appropriately.",
        },
        {
          id: "layout.disallowed_skill_assets",
          title: "Skill-local support policy",
          status: "pass",
          severity: "info",
          summary:
            "Valid Skill-local support is allowed; reusable knowledge is promoted only when deterministic evidence supports it.",
        },
        {
          id: "layout.context_root",
          title: "Canonical context root",
          status: "pass",
          severity: "info",
          summary:
            "Context assets and declared context paths use canonical roots.",
        },
        {
          id: "layout.helper_root",
          title: "Canonical helper root",
          status: "pass",
          severity: "info",
          summary:
            "Shared helpers use tools/** and Skill-specific scripts may remain local.",
        },
        {
          id: "paths.helper_commands",
          title: "Helper command paths",
          status: "pass",
          severity: "info",
          summary:
            "Markdown helper commands resolve to tools/** or valid Skill-local scripts.",
        },
        {
          id: "docs.layout_consistency",
          title: "Layout documentation consistency",
          status: "pass",
          severity: "info",
          summary:
            "Repository docs describe canonical Skill roots, valid local support, governed Context Assets, and shared helpers consistently.",
        },
      ],
      summary: {
        totalAssets: 2,
        ownedAssets: 2,
        unownedAssets: 0,
        ownershipCoveragePercent: 100,
        nodeCount: 2,
        edgeCount: 1,
        resolvedEdges: 1,
        unresolvedEdges: 0,
        graphResolutionPercent: 100,
        diagnosticCounts: {
          error: 0,
          warning: 0,
          info: 0,
        },
        workflow: {
          skillEntrypoints: 1,
          checks: 6,
          pass: 6,
          warn: 0,
          fail: 0,
          readinessPercent: 100,
        },
        contextLens: {
          enabled: true,
          detected: false,
          totalLensCount: 0,
          validLensCount: 0,
          invalidLensCount: 0,
          diagnosticCounts: {
            error: 0,
            warning: 0,
            info: 0,
          },
          definitionPaths: [],
          targetReferences: [],
          targetPaths: [],
          unresolvedTargetReferences: [],
          scopeSummary: [],
          lenses: [],
        },
        securityPosture: {
          totalSecurityFindings: 0,
          riskClasses: {
            violation: 0,
            suspicious: 0,
            advisory: 0,
            unclassified: 0,
          },
          severities: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
          },
          highOrCritical: 0,
          topFindingIds: [],
        },
        securityPolicyInventory: {
          totalPolicyAssets: 2,
          assetsWithPolicyMetadata: 2,
          assetsMissingPolicyMetadata: 0,
          assetKinds: {
            skill: 1,
            context: 1,
            context_lens: 0,
            agent: 0,
            profile: 0,
            reference: 0,
            example: 0,
            script: 0,
            asset: 0,
            config: 0,
            unknown: 0,
          },
          networkAllowed: {
            true: 0,
            false: 2,
            unspecified: 0,
          },
          externalUploadAllowed: {
            true: 0,
            false: 2,
            unspecified: 0,
          },
          secretsAllowed: {
            true: 0,
            false: 2,
            unspecified: 0,
          },
          humanApprovalRequired: {
            true: 2,
            false: 0,
            unspecified: 0,
          },
          approvedNetworkDestinationCount: 0,
          approvedUploadDestinationCount: 0,
          forbiddenInputCount: 0,
          disallowedCommandCount: 0,
          securityProfiles: {
            referenced: 0,
            resolved: 0,
            missing: 0,
            cyclic: 0,
            none: 2,
            names: [],
          },
          topApprovedNetworkDestinations: [],
          topApprovedUploadDestinations: [],
          topForbiddenInputs: [],
          missingPolicyAssets: [],
        },
      },
    },
    securityPosture: {
      totalSecurityFindings: 0,
      riskClasses: {
        violation: 0,
        suspicious: 0,
        advisory: 0,
        unclassified: 0,
      },
      severities: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      highOrCritical: 0,
      topFindingIds: [],
    },
    securityPolicyInventory: {
      totalPolicyAssets: 2,
      assetsWithPolicyMetadata: 2,
      assetsMissingPolicyMetadata: 0,
      assetKinds: {
        skill: 1,
        context: 1,
        context_lens: 0,
        agent: 0,
        profile: 0,
        reference: 0,
        example: 0,
        script: 0,
        asset: 0,
        config: 0,
        unknown: 0,
      },
      networkAllowed: {
        true: 0,
        false: 2,
        unspecified: 0,
      },
      externalUploadAllowed: {
        true: 0,
        false: 2,
        unspecified: 0,
      },
      secretsAllowed: {
        true: 0,
        false: 2,
        unspecified: 0,
      },
      humanApprovalRequired: {
        true: 2,
        false: 0,
        unspecified: 0,
      },
      approvedNetworkDestinationCount: 0,
      approvedUploadDestinationCount: 0,
      forbiddenInputCount: 0,
      disallowedCommandCount: 0,
      securityProfiles: {
        referenced: 0,
        resolved: 0,
        missing: 0,
        cyclic: 0,
        none: 2,
        names: [],
      },
      topApprovedNetworkDestinations: [],
      topApprovedUploadDestinations: [],
      topForbiddenInputs: [],
      missingPolicyAssets: [],
    },
    diagnostics: [],
  };
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
