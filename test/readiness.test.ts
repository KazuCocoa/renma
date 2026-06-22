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
  assert.deepEqual(report.summary.workflow, {
    skillEntrypoints: 1,
    checks: 5,
    pass: 5,
    warn: 0,
    fail: 0,
    readinessPercent: 100,
  });
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

test("readiness markdown prints a compact reviewable report", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { owner: "platform" });

  const markdown = formatReadinessMarkdown(await readiness(root));

  assert.match(markdown, /^# Agent Readiness/m);
  assert.match(markdown, /\| Total assets \| 1 \|/);
  assert.match(markdown, /^## Workflow Readiness$/m);
  assert.match(markdown, /\| Skill entrypoints \| 1 \|/);
  assert.match(markdown, /\| Workflow readiness \| 100% \|/);
  assert.match(markdown, /\| ownership\.coverage \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.optional_context \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.clarity \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.required_inputs \| pass \| info \|/);
  assert.match(markdown, /\| workflow\.completion_criteria \| pass \| info \|/);
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
    markdown({
      id,
      ...metadata,
      title: `# ${id}`,
      body: metadata.body ?? workflowReadySkillBody(id),
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
