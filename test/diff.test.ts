import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildDiffReport, diff, formatDiff } from "../src/commands/diff.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../src/security-policy-inventory.js";

const execFile = promisify(execFileCallback);

test("buildDiffReport compares deterministic readiness snapshots", () => {
  const fromSnapshot = snapshot("base", {
    score: 82,
    level: "not_ready",
    totalAssets: 2,
    ownershipCoveragePercent: 50,
    graphResolutionPercent: 50,
    nodes: [
      node("skill", "skills/demo/SKILL.md", "skill", "platform", "draft"),
      node("old-context", "contexts/old.md", "context", "docs", "stable"),
    ],
    edges: [
      edge(
        "skill",
        "shared-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
      edge(
        "skill",
        "regressed-context",
        "requires",
        true,
        "skills/demo/SKILL.md",
      ),
    ],
    checks: [
      check(
        "workflow.completion_criteria",
        "warn",
        "warning",
        "Missing criteria",
      ),
    ],
    findings: [
      finding(
        "QUAL-MISSING-COMPLETION-CRITERIA",
        "high",
        "skills/demo/SKILL.md",
        12,
      ),
      finding(
        "SEC-MISSING-POLICY-METADATA",
        "medium",
        "skills/demo/SKILL.md",
        4,
        "advisory",
      ),
    ],
    securityPolicyInventory: policyInventory({
      totalPolicyAssets: 2,
      assetsWithPolicyMetadata: 1,
      assetsMissingPolicyMetadata: 1,
      networkDenied: 1,
      uploadDenied: 1,
      secretsDenied: 1,
      approvedNetworkDestinationCount: 1,
      approvedUploadDestinationCount: 1,
      forbiddenInputCount: 2,
      cyclicSecurityProfiles: 1,
    }),
  });
  const toSnapshot = snapshot("head", {
    score: 91,
    level: "ready",
    totalAssets: 3,
    ownershipCoveragePercent: 100,
    graphResolutionPercent: 75,
    nodes: [
      node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      node("new-context", "contexts/new.md", "context", "docs", "stable"),
    ],
    edges: [
      edge("skill", "shared-context", "requires", true, "skills/demo/SKILL.md"),
      edge(
        "skill",
        "missing-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
      edge(
        "skill",
        "regressed-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
    ],
    checks: [
      check("workflow.completion_criteria", "pass", "info", "Criteria present"),
    ],
    findings: [
      finding("MAINT-REPEATED-CODE-BLOCK", "low", "docs/guide.md", 2),
      finding(
        "SEC-DESTRUCTIVE-COMMAND",
        "critical",
        "skills/demo/SKILL.md",
        20,
        "violation",
      ),
    ],
    securityPolicyInventory: policyInventory({
      totalPolicyAssets: 4,
      assetsWithPolicyMetadata: 3,
      assetsMissingPolicyMetadata: 0,
      networkAllowed: 1,
      networkDenied: 1,
      uploadDenied: 2,
      secretsAllowed: 1,
      secretsDenied: 1,
      humanApprovalRequired: 1,
      approvedNetworkDestinationCount: 3,
      approvedUploadDestinationCount: 1,
      forbiddenInputCount: 3,
      missingSecurityProfiles: 1,
    }),
  });

  const report = buildDiffReport("/repo", fromSnapshot, toSnapshot);

  assert.deepEqual(report.summary, {
    readinessScoreDelta: 9,
    readinessLevelChanged: true,
    totalAssetsDelta: 1,
    ownershipCoverageDelta: 50,
    graphResolutionDelta: 25,
    findingsDelta: 0,
    highOrCriticalFindingsDelta: 0,
  });
  assert.deepEqual(
    report.catalog.addedAssets.map((asset) => asset.id),
    ["new-context"],
  );
  assert.deepEqual(
    report.catalog.removedAssets.map((asset) => asset.id),
    ["old-context"],
  );
  assert.deepEqual(report.catalog.changedAssets[0]?.changedFields, ["status"]);
  assert.deepEqual(
    report.graph.newUnresolvedEdges.map((edge) => edge.target),
    ["missing-context", "regressed-context"],
  );
  assert.deepEqual(
    report.graph.resolvedEdges.map((edge) => edge.target),
    ["shared-context"],
  );
  assert.deepEqual(report.readiness.checkChanges[0], {
    id: "workflow.completion_criteria",
    title: "Completion criteria",
    fromStatus: "warn",
    toStatus: "pass",
    fromSeverity: "warning",
    toSeverity: "info",
    summaryChanged: true,
  });
  assert.deepEqual(
    report.findings.countById.map((entry) => [entry.id, entry.delta]),
    [
      ["MAINT-REPEATED-CODE-BLOCK", 1],
      ["QUAL-MISSING-COMPLETION-CRITERIA", -1],
      ["SEC-DESTRUCTIVE-COMMAND", 1],
      ["SEC-MISSING-POLICY-METADATA", -1],
    ],
  );
  assert.equal(
    report.findings.added.some(
      (finding) => finding.title === "SEC-DESTRUCTIVE-COMMAND",
    ),
    true,
  );
  assert.equal("message" in report.findings.added[0]!, false);
  assert.equal(report.security.posture.added.totalSecurityFindings, 1);
  assert.equal(report.security.posture.added.riskClasses.violation, 1);
  assert.equal(report.security.posture.resolved.totalSecurityFindings, 1);
  assert.equal(report.security.posture.resolved.riskClasses.advisory, 1);
  assert.equal(report.security.policyInventory.totalPolicyAssets, 2);
  assert.equal(report.security.policyInventory.assetsWithPolicyMetadata, 2);
  assert.equal(report.security.policyInventory.assetsMissingPolicyMetadata, -1);
  assert.equal(report.security.policyInventory.networkAllowed.true, 1);
  assert.equal(report.security.policyInventory.securityProfiles.missing, 1);
  assert.equal(report.security.policyInventory.securityProfiles.cyclic, -1);
});

test("formatDiff renders markdown summaries", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      securityPolicyInventory: policyInventory({
        totalPolicyAssets: 1,
        assetsMissingPolicyMetadata: 1,
        networkDenied: 1,
      }),
    }),
    snapshot("head", {
      score: 90,
      scannedFileCount: 6,
      totalAssets: 1,
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
      findings: [
        finding("MAINT-REPEATED-CODE-BLOCK", "high", "docs/guide.md", 12),
        finding(
          "SEC-LITERAL-SECRET",
          "high",
          "skills/demo/SKILL.md",
          4,
          "violation",
        ),
      ],
      securityPolicyInventory: policyInventory({
        totalPolicyAssets: 3,
        assetsWithPolicyMetadata: 2,
        assetsMissingPolicyMetadata: 0,
        networkAllowed: 1,
        networkDenied: 1,
        missingSecurityProfiles: 1,
      }),
    }),
  );

  const markdown = formatDiff(report, "markdown");
  const parsed = JSON.parse(formatDiff(report, "json"));

  assert.match(markdown, /# Renma semantic diff/);
  assert.match(markdown, /Refs: `base` -> `head`/);
  assert.match(markdown, /Readiness score: 90 \(\+90\)/);
  assert.match(markdown, /Scanned files: 6 \(\+6\)/);
  assert.match(markdown, /Total assets: 1 \(\+1\)/);
  assert.doesNotMatch(markdown, /- Assets:/);
  assert.match(markdown, /Added assets: 1/);
  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 1/);
  assert.match(markdown, /- Resolved security findings: 0/);
  assert.match(markdown, /- Added violations: 1/);
  assert.match(markdown, /- Policy assets: \+2/);
  assert.match(markdown, /- Assets with policy metadata: \+2/);
  assert.match(markdown, /- Assets missing policy metadata: -1/);
  assert.match(markdown, /- Network allowed: \+1/);
  assert.match(markdown, /- Missing security profiles: \+1/);
  assert.match(
    markdown,
    /- MAINT-REPEATED-CODE-BLOCK \(high\) at docs\/guide\.md/,
  );
  assert.match(
    markdown,
    /- HIGH \[violation\] SEC-LITERAL-SECRET at skills\/demo\/SKILL\.md/,
  );
  assert.equal(parsed.security.posture.added.totalSecurityFindings, 1);
  assert.equal(parsed.security.policyInventory.totalPolicyAssets, 2);
});

test("formatDiff tolerates legacy reports without security diff", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {}),
  );
  delete (report as Partial<typeof report>).security;

  const markdown = formatDiff(report, "markdown");

  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 0/);
  assert.match(markdown, /- Policy assets: \+0/);
});

test("diff resolves the git repository from an absolute target path", async () => {
  const repo = await createGitRepo();
  const outside = await mkdtemp(join(tmpdir(), "renma-diff-outside-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(outside);
    const report = await diff(repo, { fromRef: "base", toRef: "HEAD" });
    assert.equal(report.root, await realpath(repo));
    assert.equal(report.from.totalAssets, 1);
    assert.equal(report.to.totalAssets, 2);
    assert.equal(report.summary.totalAssetsDelta, 1);
  } finally {
    process.chdir(previousCwd);
    await rm(repo, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test("diff reports invalid refs with git context", async () => {
  const repo = await createGitRepo();
  try {
    await assert.rejects(
      diff(repo, { fromRef: "missing-ref", toRef: "HEAD" }),
      /git archive .*missing-ref/i,
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("diff does not mutate the working tree", async () => {
  const repo = await createGitRepo();
  try {
    await writeFile(
      join(repo, "skills", "demo", "SKILL.md"),
      skillMarkdown("demo", "changed"),
    );
    await writeFile(join(repo, "notes.txt"), "local note\n");
    const before = await git(repo, ["status", "--short"]);
    await diff(repo, { fromRef: "base", toRef: "HEAD" });
    const after = await git(repo, ["status", "--short"]);
    assert.equal(after, before);
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

function snapshot(ref: string, overrides: Partial<SnapshotInput>) {
  const input = {
    score: 0,
    level: "not_ready",
    totalAssets: 0,
    scannedFileCount: 0,
    ownershipCoveragePercent: 0,
    graphResolutionPercent: 0,
    nodes: [],
    edges: [],
    checks: [],
    findings: [],
    ...overrides,
  };
  return {
    ref,
    root: `/tmp/${ref}`,
    readiness: {
      root: `/tmp/${ref}`,
      scannedFileCount: input.scannedFileCount,
      score: input.score,
      level: input.level,
      summary: {
        totalAssets: input.totalAssets,
        ownedAssets: 0,
        unownedAssets: input.totalAssets,
        ownershipCoveragePercent: input.ownershipCoveragePercent,
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        resolvedEdges: input.edges.filter((item) => item.resolved).length,
        unresolvedEdges: input.edges.filter((item) => !item.resolved).length,
        graphResolutionPercent: input.graphResolutionPercent,
        diagnosticCounts: { error: 0, warning: 0, info: 0 },
        workflow: {
          skillEntrypoints: 0,
          checks: 0,
          pass: 0,
          warn: 0,
          fail: 0,
          readinessPercent: 0,
        },
        securityPolicyInventory: input.securityPolicyInventory,
      },
      checks: input.checks,
      findings: input.findings,
    },
    graph: {
      root: `/tmp/${ref}`,
      scannedFileCount: input.totalAssets,
      nodeCount: input.nodes.length,
      edgeCount: input.edges.length,
      nodes: input.nodes,
      edges: input.edges,
    },
  } as unknown as Parameters<typeof buildDiffReport>[1];
}

interface SnapshotInput {
  score: number;
  level: string;
  totalAssets: number;
  scannedFileCount: number;
  ownershipCoveragePercent: number;
  graphResolutionPercent: number;
  nodes: Array<ReturnType<typeof node>>;
  edges: Array<ReturnType<typeof edge>>;
  checks: Array<ReturnType<typeof check>>;
  findings: Array<ReturnType<typeof finding>>;
  securityPolicyInventory?: SecurityPolicyInventorySummary | undefined;
}

interface PolicyInventoryInput {
  totalPolicyAssets?: number | undefined;
  assetsWithPolicyMetadata?: number | undefined;
  assetsMissingPolicyMetadata?: number | undefined;
  networkAllowed?: number | undefined;
  networkDenied?: number | undefined;
  uploadAllowed?: number | undefined;
  uploadDenied?: number | undefined;
  secretsAllowed?: number | undefined;
  secretsDenied?: number | undefined;
  humanApprovalRequired?: number | undefined;
  approvedNetworkDestinationCount?: number | undefined;
  approvedUploadDestinationCount?: number | undefined;
  forbiddenInputCount?: number | undefined;
  missingSecurityProfiles?: number | undefined;
  cyclicSecurityProfiles?: number | undefined;
}

function policyInventory(
  input: PolicyInventoryInput,
): SecurityPolicyInventorySummary {
  const inventory = zeroSecurityPolicyInventorySummary();
  inventory.totalPolicyAssets = input.totalPolicyAssets ?? 0;
  inventory.assetsWithPolicyMetadata = input.assetsWithPolicyMetadata ?? 0;
  inventory.assetsMissingPolicyMetadata =
    input.assetsMissingPolicyMetadata ?? 0;
  inventory.networkAllowed.true = input.networkAllowed ?? 0;
  inventory.networkAllowed.false = input.networkDenied ?? 0;
  inventory.externalUploadAllowed.true = input.uploadAllowed ?? 0;
  inventory.externalUploadAllowed.false = input.uploadDenied ?? 0;
  inventory.secretsAllowed.true = input.secretsAllowed ?? 0;
  inventory.secretsAllowed.false = input.secretsDenied ?? 0;
  inventory.humanApprovalRequired.true = input.humanApprovalRequired ?? 0;
  inventory.approvedNetworkDestinationCount =
    input.approvedNetworkDestinationCount ?? 0;
  inventory.approvedUploadDestinationCount =
    input.approvedUploadDestinationCount ?? 0;
  inventory.forbiddenInputCount = input.forbiddenInputCount ?? 0;
  inventory.securityProfiles.missing = input.missingSecurityProfiles ?? 0;
  inventory.securityProfiles.cyclic = input.cyclicSecurityProfiles ?? 0;
  return inventory;
}

function node(
  id: string,
  sourcePath: string,
  kind: string,
  owner: string,
  status: string,
) {
  return { id, sourcePath, kind, owner, status };
}

function edge(
  source: string,
  target: string,
  kind: string,
  resolved: boolean,
  path: string,
) {
  return {
    source,
    target,
    kind,
    resolved,
    evidence: { path, startLine: 1, endLine: 1, snippet: target },
  };
}

function check(id: string, status: string, severity: string, summary: string) {
  return {
    id,
    title: "Completion criteria",
    status,
    severity,
    summary,
  };
}

function finding(
  id: string,
  severity: string,
  path: string,
  line: number,
  riskClass?: string,
) {
  return {
    id,
    severity,
    ...(riskClass ? { riskClass } : {}),
    title: id,
    evidence: { path, startLine: line, endLine: line, snippet: id },
  };
}

async function createGitRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-diff-repo-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeSkill(repo, "demo", "draft");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["tag", "base"]);
  await writeSkill(repo, "extra", "stable");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "head"]);
  return repo;
}

async function writeSkill(
  repo: string,
  id: string,
  status: string,
): Promise<void> {
  const directory = join(repo, "skills", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), skillMarkdown(id, status));
}

function skillMarkdown(id: string, status: string): string {
  return `---\nid: ${id}\nowner: platform\nstatus: ${status}\ntags: []\n---\n# ${id}\n\nUse this skill when testing semantic diff.\n`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args]);
  return stdout.trim();
}
