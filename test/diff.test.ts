import assert from "node:assert/strict";
import test from "node:test";
import { buildDiffReport, formatDiff } from "../src/commands/diff.js";

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
      edge("skill", "shared-context", "requires", false, "skills/demo/SKILL.md"),
    ],
    checks: [check("workflow.completion_criteria", "warn", "warning", "Missing criteria")],
    findings: [
      finding("QUAL-MISSING-COMPLETION-CRITERIA", "high", "skills/demo/SKILL.md", 12),
    ],
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
      edge("skill", "missing-context", "requires", false, "skills/demo/SKILL.md"),
    ],
    checks: [check("workflow.completion_criteria", "pass", "info", "Criteria present")],
    findings: [
      finding("SEC-DESTRUCTIVE-COMMAND", "critical", "skills/demo/SKILL.md", 20),
    ],
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
    ["missing-context"],
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
      ["QUAL-MISSING-COMPLETION-CRITERIA", -1],
      ["SEC-DESTRUCTIVE-COMMAND", 1],
    ],
  );
});

test("formatDiff renders markdown summaries", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {
      score: 90,
      totalAssets: 1,
      nodes: [node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable")],
    }),
  );

  const markdown = formatDiff(report, "markdown");

  assert.match(markdown, /# Renma semantic diff/);
  assert.match(markdown, /Refs: `base` -> `head`/);
  assert.match(markdown, /Readiness score: 90 \(\+90\)/);
  assert.match(markdown, /Added assets: 1/);
});

function snapshot(ref: string, overrides: Partial<SnapshotInput>) {
  const input = {
    score: 0,
    level: "not_ready",
    totalAssets: 0,
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
      scannedFileCount: input.totalAssets,
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
        workflow: { skillEntrypoints: 0, checks: 0, pass: 0, warn: 0, fail: 0, readinessPercent: 0 },
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
  ownershipCoveragePercent: number;
  graphResolutionPercent: number;
  nodes: Array<ReturnType<typeof node>>;
  edges: Array<ReturnType<typeof edge>>;
  checks: Array<ReturnType<typeof check>>;
  findings: Array<ReturnType<typeof finding>>;
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

function finding(id: string, severity: string, path: string, line: number) {
  return {
    id,
    severity,
    message: id,
    evidence: { path, startLine: line, endLine: line, snippet: id },
  };
}
