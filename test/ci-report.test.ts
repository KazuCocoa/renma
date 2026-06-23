import assert from "node:assert/strict";
import test from "node:test";
import { formatCiReport, type CiReport } from "../src/commands/ci-report.js";

test("formatCiReport renders deterministic markdown review artifact", () => {
  const report = sampleReport();

  const markdown = formatCiReport(report, "markdown");

  assert.match(markdown, /# Renma CI Report/);
  assert.match(markdown, /- Status: FAIL/);
  assert.match(markdown, /- Range: `main` -> `HEAD`/);
  assert.match(markdown, /- New unresolved required edges: 1/);
  assert.match(markdown, /- HIGH MAINT-REPEATED-CODE-BLOCK docs\/guide.md:12 - Repeated code block/);
  assert.match(markdown, /Review new unresolved required edges before merge\./);
});

test("formatCiReport renders structured JSON", () => {
  const json = formatCiReport(sampleReport(), "json");
  const parsed = JSON.parse(json) as CiReport;

  assert.equal(parsed.status, "fail");
  assert.equal(parsed.summary.highOrCriticalFindingsDelta, 1);
  assert.equal(parsed.diff.findings.added[0]?.id, "MAINT-REPEATED-CODE-BLOCK");
});

function sampleReport(): CiReport {
  return {
    root: "/repo",
    from: {
      ref: "main",
      scannedFileCount: 8,
      totalAssets: 10,
      readinessScore: 72,
      readinessLevel: "not_ready",
    },
    to: {
      ref: "HEAD",
      scannedFileCount: 8,
      totalAssets: 12,
      readinessScore: 80,
      readinessLevel: "needs_attention",
    },
    status: "fail",
    summary: {
      readinessScoreDelta: 8,
      readinessLevelChanged: true,
      totalAssetsDelta: 2,
      ownershipCoverageDelta: 1,
      graphResolutionDelta: 0,
      findingsDelta: 1,
      highOrCriticalFindingsDelta: 1,
    },
    notes: ["Review new unresolved required edges before merge."],
    diff: {
      root: "/repo",
      from: {
        ref: "main",
        scannedFileCount: 8,
        totalAssets: 10,
        readinessScore: 72,
        readinessLevel: "not_ready",
      },
      to: {
        ref: "HEAD",
        scannedFileCount: 8,
        totalAssets: 12,
        readinessScore: 80,
        readinessLevel: "needs_attention",
      },
      summary: {
        readinessScoreDelta: 8,
        readinessLevelChanged: true,
        totalAssetsDelta: 2,
        ownershipCoverageDelta: 1,
        graphResolutionDelta: 0,
        findingsDelta: 1,
        highOrCriticalFindingsDelta: 1,
      },
      catalog: {
        addedAssets: [],
        removedAssets: [],
        changedAssets: [],
      },
      graph: {
        addedEdges: [],
        removedEdges: [],
        newUnresolvedEdges: [
          {
            from: "skills/demo/SKILL.md",
            to: "docs/guide.md",
            relationship: "requires",
          },
        ],
        resolvedEdges: [],
      },
      readiness: {
        checkChanges: [],
      },
      findings: {
        added: [
          {
            id: "MAINT-REPEATED-CODE-BLOCK",
            severity: "high",
            title: "Repeated code block",
            evidence: {
              path: "docs/guide.md",
              startLine: 12,
            },
          },
        ],
        removed: [],
        countById: [
          {
            id: "MAINT-REPEATED-CODE-BLOCK",
            from: 0,
            to: 1,
            delta: 1,
          },
        ],
      },
    } as unknown as CiReport["diff"],
  };
}
