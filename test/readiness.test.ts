import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import type { GraphReport } from "../src/commands/graph.js";
import {
  buildReadinessReport,
  formatReadinessJson,
  formatReadinessMarkdown,
  readiness,
  type ReadinessReport,
  type ReadinessCheckStatus,
} from "../src/commands/readiness.js";
import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "../src/context-lens.js";
import type { Finding } from "../src/types.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

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
  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 5,
    warn: 0,
    fail: 0,
    readinessPercent: 100,
  });
  const workflowCheckIds = report.checks
    .filter((check) => check.id.startsWith("workflow."))
    .map((check) => check.id);
  assert.deepEqual(workflowCheckIds, [
    "workflow.context_closure",
    "workflow.optional_context",
    "workflow.clarity",
    "workflow.required_inputs",
    "workflow.completion_criteria",
  ]);
  assertCheckStatuses(report, {
    "diagnostics.errors": "pass",
    "ownership.coverage": "pass",
    "graph.unresolved_edges": "pass",
    "workflow.context_closure": "pass",
    "workflow.optional_context": "pass",
    "workflow.clarity": "pass",
    "workflow.required_inputs": "pass",
    "workflow.completion_criteria": "pass",
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
  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 4,
    warn: 0,
    fail: 1,
    readinessPercent: 80,
  });
  assertCheckStatuses(report, {
    "diagnostics.errors": "pass",
    "ownership.coverage": "warn",
    "graph.unresolved_edges": "fail",
    "workflow.context_closure": "fail",
    "workflow.optional_context": "pass",
    "workflow.clarity": "pass",
    "workflow.required_inputs": "pass",
    "workflow.completion_criteria": "pass",
    "assets.lifecycle": "warn",
    "assets.minimum_inventory": "pass",
    "layout.skills_thin": "pass",
    "layout.disallowed_skill_assets": "pass",
    "paths.helper_commands": "pass",
  });
});

test("readiness fails workflow context closure for missing required context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    requiresContext: ["missing.context"],
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.context_closure",
  );

  assert.equal(report.level, "not_ready");
  assert.equal(check?.status, "fail");
  assert.match(check?.evidence?.[0]?.message ?? "", /missing\.context/);
});

test("readiness fails workflow context closure for deprecated required context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    requiresContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "deprecated",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.context_closure",
  );

  assert.equal(report.level, "not_ready");
  assert.equal(check?.status, "fail");
  assert.match(check?.evidence?.[0]?.message ?? "", /deprecated/);
});

test("readiness fails workflow context closure for archived required context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    requiresContext: ["testing.legacy"],
  });
  await writeContext(root, "testing", "legacy", {
    owner: "docs",
    status: "archived",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.context_closure",
  );

  assert.equal(report.level, "not_ready");
  assert.equal(check?.status, "fail");
  assert.match(check?.evidence?.[0]?.message ?? "", /archived/);
});

test("readiness passes workflow context closure for skill without requires edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.context_closure",
  );

  assert.equal(check?.status, "pass");
});

test("readiness warns on freshness findings without failing readiness", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "workflow.md"),
    `---
id: testing.workflow
owner: docs
expires_at: 2000-01-01
---

# Workflow Context
`,
  );

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "assets.freshness",
  );

  assert.equal(check?.status, "warn");
  assert.match(check?.summary ?? "", /freshness finding/);
  assert.equal(
    report.findings?.some((finding) => finding.id === "MAINT-ASSET-EXPIRED"),
    true,
  );
  assert.notEqual(report.level, "not_ready");
});

test("readiness passes workflow optional context when none is declared", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.optional_context",
  );

  assert.equal(report.score, 100);
  assert.equal(report.level, "ready");
  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 5,
    warn: 0,
    fail: 0,
    readinessPercent: 100,
  });
  assert.equal(check?.status, "pass");
  assert.equal(
    check?.summary,
    "No optional workflow context references were declared.",
  );
});

test("readiness passes workflow optional context for usable optional assets", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    optionalContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "stable",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.optional_context",
  );

  assert.equal(report.score, 100);
  assert.equal(report.level, "ready");
  assert.equal(check?.status, "pass");
  assert.equal(
    check?.summary,
    "All declared optional workflow context references are usable.",
  );
});

test("readiness warns for missing workflow optional context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    optionalContext: ["missing.context"],
  });

  const report = await readiness(root);
  const optionalCheck = report.checks.find(
    (candidate) => candidate.id === "workflow.optional_context",
  );
  const graphCheck = report.checks.find(
    (candidate) => candidate.id === "graph.unresolved_edges",
  );

  assert.equal(report.score, 95);
  assert.equal(report.level, "ready");
  assert.equal(optionalCheck?.status, "warn");
  assert.equal(optionalCheck?.severity, "warning");
  assert.equal(
    optionalCheck?.summary,
    "1 optional workflow context reference(s) need attention.",
  );
  assert.equal(optionalCheck?.evidence?.[0]?.id, "demo");
  assert.equal(optionalCheck?.evidence?.[0]?.path, "skills/demo/SKILL.md");
  assert.match(optionalCheck?.evidence?.[0]?.message ?? "", /missing\.context/);
  assert.equal(graphCheck?.status, "pass");
});

test("readiness warns for deprecated workflow optional context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    optionalContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "deprecated",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.optional_context",
  );

  // Optional-context and lifecycle warnings each apply a 5-point penalty.
  assert.equal(report.score, 90);
  assert.equal(report.level, "ready");
  assert.equal(check?.status, "warn");
  assert.equal(check?.severity, "warning");
  assert.match(check?.evidence?.[0]?.message ?? "", /deprecated/);
  assert.match(
    check?.evidence?.[0]?.message ?? "",
    /contexts\/testing\/boundary\.md/,
  );
});

test("readiness warns for archived workflow optional context", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    optionalContext: ["testing.legacy"],
  });
  await writeContext(root, "testing", "legacy", {
    owner: "docs",
    status: "archived",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.optional_context",
  );

  // Optional-context and lifecycle warnings each apply a 5-point penalty.
  assert.equal(report.score, 90);
  assert.equal(report.level, "ready");
  assert.equal(check?.status, "warn");
  assert.equal(check?.severity, "warning");
  assert.match(check?.evidence?.[0]?.message ?? "", /archived/);
  assert.match(
    check?.evidence?.[0]?.message ?? "",
    /contexts\/testing\/legacy\.md/,
  );
});

test("readiness warns for unclear skill workflow entrypoint", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    description: "Too short.",
    body: "# demo\nUse for readiness report tests.\n\n## Completion criteria\nThe workflow is complete when readiness output is deterministic.\n",
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.clarity",
  );

  assert.equal(report.score, 75);
  assert.equal(report.level, "needs_attention");
  assert.equal(check?.status, "warn");
  assert.equal(check?.severity, "warning");
  assert.equal(check?.evidence?.[0]?.path, "skills/demo/SKILL.md");
  assert.match(check?.summary ?? "", /workflow clarity finding/);
});

test("readiness warns and applies penalty for missing workflow required inputs", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    body: workflowReadySkillBodyWithoutRequiredInputs("demo"),
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.required_inputs",
  );

  assert.equal(report.score, 90);
  assert.equal(report.level, "ready");
  assert.equal(check?.status, "warn");
  assert.equal(check?.severity, "warning");
  assert.equal(check?.evidence?.[0]?.id, "QUAL-MISSING-REQUIRED-INPUTS");
  assert.equal(check?.evidence?.[0]?.path, "skills/demo/SKILL.md");
});

test("readiness warns and applies penalty for missing workflow completion criteria", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    body: workflowReadySkillBodyWithoutCompletionCriteria("demo"),
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "workflow.completion_criteria",
  );

  assert.equal(report.score, 85);
  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 4,
    warn: 1,
    fail: 0,
    readinessPercent: 80,
  });
  assert.equal(report.level, "needs_attention");
  assert.equal(check?.status, "warn");
  assert.equal(check?.severity, "warning");
  assert.equal(check?.evidence?.[0]?.id, "QUAL-MISSING-COMPLETION-CRITERIA");
  assert.equal(check?.evidence?.[0]?.path, "skills/demo/SKILL.md");
});

test("readiness applies stable score contract for workflow warnings", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    optionalContext: ["missing.context"],
    body: workflowReadySkillBodyWithoutCompletionCriteria("demo"),
  });

  const report = await readiness(root);

  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 3,
    warn: 2,
    fail: 0,
    readinessPercent: 60,
  });
  assertCheckStatuses(report, {
    "graph.unresolved_edges": "pass",
    "workflow.optional_context": "warn",
    "workflow.completion_criteria": "warn",
  });
  assert.equal(report.score, 80);
  assert.equal(report.level, "needs_attention");
});

test("readiness JSON includes security posture summary", () => {
  const parsed = JSON.parse(
    formatReadinessJson(securityPostureReadinessReport()),
  ) as ReadinessReport;

  assert.deepEqual(parsed.summary.securityPosture.riskClasses, {
    violation: 1,
    suspicious: 1,
    advisory: 1,
    unclassified: 0,
  });
  assert.equal(parsed.summary.securityPosture.totalSecurityFindings, 3);
  assert.equal(parsed.summary.securityPosture.highOrCritical, 1);
  assert.deepEqual(
    parsed.summary.securityPosture.topFindingIds.map((finding) => finding.id),
    [
      "SEC-UNAPPROVED-NETWORK-DESTINATION",
      "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
      "SEC-MISSING-POLICY-METADATA",
    ],
  );
});

test("readiness markdown includes security posture counts", () => {
  const markdown = formatReadinessMarkdown(securityPostureReadinessReport());

  assert.match(markdown, /^## Security Posture$/m);
  assert.match(markdown, /\| Security findings \| 3 \|/);
  assert.match(markdown, /\| Violations \| 1 \|/);
  assert.match(markdown, /\| Suspicious \| 1 \|/);
  assert.match(markdown, /\| Advisory \| 1 \|/);
  assert.match(markdown, /\| High\/critical security findings \| 1 \|/);
  assert.match(
    markdown,
    /- SEC-UNAPPROVED-NETWORK-DESTINATION: 1 \[violation, high\]/,
  );
});

test("readiness JSON includes security policy inventory summary", async () => {
  const root = await fixture();
  await writePolicySkill(root);
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "stable",
  });

  const report = await readiness(root);
  const inventory = report.summary.securityPolicyInventory;

  assert.equal(inventory.totalPolicyAssets, 2);
  assert.equal(inventory.assetsWithPolicyMetadata, 1);
  assert.equal(inventory.assetsMissingPolicyMetadata, 1);
  assert.deepEqual(inventory.networkAllowed, {
    true: 1,
    false: 0,
    unspecified: 1,
  });
  assert.equal(inventory.approvedNetworkDestinationCount, 1);
  assert.equal(inventory.forbiddenInputCount, 1);
  assert.deepEqual(inventory.topApprovedNetworkDestinations, [
    { destination: "api.example.com", count: 1 },
  ]);
  assert.deepEqual(inventory.topForbiddenInputs, [
    { input: "credentials", count: 1 },
  ]);

  const parsed = JSON.parse(formatReadinessJson(report)) as ReadinessReport;
  assert.equal(
    parsed.summary.securityPolicyInventory.assetsMissingPolicyMetadata,
    1,
  );
});

test("readiness markdown includes security policy inventory", async () => {
  const root = await fixture();
  await writePolicySkill(root);
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "stable",
  });

  const markdown = formatReadinessMarkdown(await readiness(root));

  assert.match(markdown, /^## Security Policy Inventory$/m);
  assert.match(markdown, /\| Policy assets \| 2 \|/);
  assert.match(markdown, /\| Assets with policy metadata \| 1 \|/);
  assert.match(markdown, /\| Assets missing policy metadata \| 1 \|/);
  assert.match(markdown, /\| Network allowed \| 1 \|/);
  assert.match(markdown, /\| Forbidden inputs \| 1 \|/);
  assert.match(markdown, /^### Top approved network destinations$/m);
  assert.match(markdown, /- api\.example\.com: 1/);
  assert.match(markdown, /^### Top forbidden inputs$/m);
  assert.match(markdown, /- credentials: 1/);
});

test("readiness markdown prints a compact reviewable report", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { owner: "platform" });

  const markdown = formatReadinessMarkdown(await readiness(root));

  assert.match(markdown, /^# Agent Readiness/m);
  assert.match(markdown, /\| Total assets \| 1 \|/);
  assert.match(markdown, /^## Workflow Readiness$/m);
  assert.match(markdown, /\| Skill entrypoints \| 1 \|/);
  assert.match(markdown, /\| Workflow readiness \| 100% \|/);
  assert.ok(
    markdown.includes(
      "- Workflow readiness: 100% (5/5 workflow checks passing)",
    ),
  );
  assert.ok(markdown.includes("- Graph resolution: 100% (0/0 edges resolved)"));
  assert.ok(markdown.includes("- Ownership coverage: 100% (1/1 assets owned)"));
  assert.match(markdown, /\| ownership\.coverage \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.optional_context \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.clarity \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.required_inputs \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.completion_criteria \| pass \| info \|/);
});

test("readiness includes Context Lens diagnostics and fails blocking issues", async () => {
  const root = await fixture();
  await writeContext(root, "testing", "boundary", {
    owner: "docs",
    status: "stable",
  });
  await writeLens(root, "testing", "spec-review", {
    owner: "qa-platform",
    appliesTo: ["testing.boundary"],
  });

  const report = await readiness(root);
  const check = report.checks.find(
    (candidate) => candidate.id === "context_lens.governance",
  );

  assert.equal(report.level, "not_ready");
  assert.equal(report.summary.contextLens.totalLensCount, 1);
  assert.equal(report.summary.contextLens.invalidLensCount, 1);
  assert.equal(report.summary.contextLens.diagnosticCounts.error, 1);
  assert.equal(
    report.diagnostics?.[0]?.code,
    CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
  );
  assert.equal(check?.status, "fail");
  assert.equal(check?.evidence?.[0]?.id, "CONTEXT-LENS-MISSING-REQUIRED-FIELD");

  const result = await withCapturedConsole(() =>
    main(["readiness", root, "--json"]),
  );
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(parsed.summary.contextLens.invalidLensCount, 1);
  assert.equal(
    parsed.diagnostics[0].code,
    CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
  );
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
  assert.deepEqual(parsed.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 5,
    warn: 0,
    fail: 0,
    readinessPercent: 100,
  });
  assert.equal(parsed.summary.totalAssets, 1);
  assert.equal(
    parsed.checks.find(
      (check: { id: string; status: string }) =>
        check.id === "workflow.optional_context",
    )?.status,
    "pass",
  );
  assert.equal(
    parsed.checks.find(
      (check: { id: string; status: string }) =>
        check.id === "workflow.clarity",
    )?.status,
    "pass",
  );
  assert.equal(
    parsed.checks.find(
      (check: { id: string; status: string }) =>
        check.id === "workflow.required_inputs",
    )?.status,
    "pass",
  );
  assert.equal(
    parsed.checks.find(
      (check: { id: string; status: string }) =>
        check.id === "workflow.completion_criteria",
    )?.status,
    "pass",
  );
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
    description?: string;
    status?: string;
    tags?: string[];
    requiresContext?: string[];
    optionalContext?: string[];
    body?: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "skills", id), { recursive: true });
  await writeFile(
    path.join(root, "skills", id, "SKILL.md"),
    canonicalSkillFixture(
      path.join("skills", id, "SKILL.md"),
      markdown({
        id,
        ...metadata,
        title: `# ${id}`,
        body: metadata.body ?? workflowReadySkillBody(id),
      }),
    ),
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

async function writeLens(
  root: string,
  group: string,
  id: string,
  metadata: {
    owner?: string;
    purpose?: string;
    appliesTo?: string[];
    status?: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "lenses", group), { recursive: true });
  await writeFile(
    path.join(root, "lenses", group, `${id}.md`),
    [
      "---",
      `id: lens.${group}.${id}`,
      ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
      ...(metadata.status ? [`status: ${metadata.status}`] : []),
      ...(metadata.purpose ? [`purpose: ${metadata.purpose}`] : []),
      ...(metadata.appliesTo
        ? [
            "applies_to:",
            ...metadata.appliesTo.map((target) => `  - ${target}`),
          ]
        : []),
      "---",
      `# ${id}`,
      "",
      "Review declared context for deterministic governance coverage.",
      "",
    ].join("\n"),
  );
}

async function writePolicySkill(root: string): Promise<void> {
  await mkdir(path.join(root, "skills", "policy"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "policy", "SKILL.md"),
    canonicalSkillFixture(
      "skills/policy/SKILL.md",
      [
        "---",
        "id: policy",
        "owner: platform",
        "status: stable",
        "description: Clear workflow routing for readiness report tests with deterministic security policy metadata and verification expectations.",
        "network_allowed: true",
        "approved_network_destinations: api.example.com",
        "forbidden_inputs: credentials",
        "---",
        workflowReadySkillBody("policy"),
      ].join("\n"),
    ),
  );
}

function markdown(metadata: {
  id: string;
  owner?: string;
  description?: string;
  status?: string;
  tags?: string[];
  requiresContext?: string[];
  optionalContext?: string[];
  title: string;
  body?: string;
}): string {
  return [
    "---",
    `id: ${metadata.id}`,
    `description: ${
      metadata.description ??
      "Clear workflow routing for readiness report tests with deterministic usage guidance, non-goals, preflight checks, examples, and verification expectations for agent consumers."
    }`,
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.tags ? [`tags: ${metadata.tags.join(", ")}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
      : []),
    ...(metadata.optionalContext
      ? [`optional_context: ${metadata.optionalContext.join(", ")}`]
      : []),
    "---",
    metadata.body ??
      [metadata.title, "Use for readiness report tests."].join("\n"),
    "",
  ].join("\n");
}

function workflowReadySkillBody(id: string): string {
  return [
    `# ${id}`,
    "",
    "## When to use",
    "Use this workflow for deterministic readiness report tests.",
    "",
    "## Required inputs",
    "Required inputs: repository root, target report format, and permission to read local fixture files.",
    "",
    "## DO NOT USE FOR",
    "Do not use this workflow for runtime task context selection or prompt assembly.",
    "",
    "## Preflight",
    "Before you begin, confirm the repository fixture exists and inputs are static.",
    "",
    "## Example",
    "Input: readiness report fixture. Output: deterministic check evidence.",
    "",
    "## Completion criteria",
    "The workflow is complete when the readiness command reports deterministic JSON or Markdown evidence and the final response summarizes the result.",
    "",
    "## Verification",
    "Verify by running the readiness command and checking the JSON or Markdown output.",
  ].join("\n");
}

function workflowReadySkillBodyWithoutRequiredInputs(id: string): string {
  return [
    `# ${id}`,
    "",
    "## When to use",
    "Use this workflow for deterministic readiness report tests.",
    "",
    "## DO NOT USE FOR",
    "Do not use this workflow for runtime task context selection or prompt assembly.",
    "",
    "## Preflight",
    "Before you begin, confirm the repository fixture exists and static context paths are readable.",
    "",
    "## Example",
    "Input: readiness report fixture. Output: deterministic check evidence.",
    "",
    "## Completion criteria",
    "The workflow is complete when the readiness command reports deterministic JSON or Markdown evidence and the final response summarizes the result.",
    "",
    "## Verification",
    "Verify by running the readiness command and checking the JSON or Markdown output.",
  ].join("\n");
}

function workflowReadySkillBodyWithoutCompletionCriteria(id: string): string {
  return [
    `# ${id}`,
    "",
    "## When to use",
    "Use this workflow for deterministic readiness report tests.",
    "",
    "## Required inputs",
    "Required inputs: repository root, target report format, and permission to read local fixture files.",
    "",
    "## DO NOT USE FOR",
    "Do not use this workflow for runtime task context selection or prompt assembly.",
    "",
    "## Preflight",
    "Before you begin, confirm the repository fixture exists and inputs are static.",
    "",
    "## Example",
    "Input: readiness report fixture. Output: deterministic check evidence.",
    "",
    "## Verification",
    "Verify by running the readiness command and checking the JSON or Markdown output.",
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

function securityPostureReadinessReport(): ReadinessReport {
  return buildReadinessReport(securityGraphReport(), [
    readinessFinding("SEC-MISSING-POLICY-METADATA", "medium", "advisory"),
    readinessFinding("SEC-UNAPPROVED-NETWORK-DESTINATION", "high", "violation"),
    readinessFinding("SEC-EXTERNAL-UPLOAD-INSTRUCTION", "medium", "suspicious"),
  ]);
}

function securityGraphReport(): GraphReport {
  return {
    root: "/repo",
    scannedFileCount: 1,
    view: "full",
    nodeCount: 1,
    edgeCount: 0,
    nodes: [
      {
        id: "security",
        kind: "skill",
        sourcePath: "skills/security/SKILL.md",
        owner: "platform",
        status: "stable",
        tags: [],
      },
    ],
    edges: [],
  };
}

function readinessFinding(
  id: string,
  severity: Finding["severity"],
  riskClass?: Finding["riskClass"],
): Finding {
  return {
    id,
    title: id,
    category: "safety",
    severity,
    confidence: "high",
    ...(riskClass ? { riskClass } : {}),
    evidence: {
      path: "skills/security/SKILL.md",
      startLine: 1,
      endLine: 1,
      snippet: id,
    },
    whyItMatters: "Security posture test fixture.",
    remediation: "Review the fixture finding.",
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
