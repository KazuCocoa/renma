import assert from "node:assert/strict";
import test from "node:test";
import {
  determineCiReportStatus,
  formatCiReport,
  type CiReport,
} from "../src/commands/ci-report.js";

test("formatCiReport renders deterministic markdown review artifact", () => {
  const report = sampleReport();
  report.diff.findings.added.push(
    {
      id: "DOC-NO-LINE",
      severity: "medium",
      title: "Finding without line",
      evidence: {
        path: "docs/no-line.md",
      },
    },
    {
      id: "DOC-NO-PATH",
      severity: "medium",
      title: "Finding without path",
      evidence: {},
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `DOC-EXTRA-${index + 1}`,
      severity: "low",
      title: `Overflow finding ${index + 1}`,
      evidence: {
        path: `docs/extra-${index + 1}.md`,
        startLine: index + 1,
      },
    })),
  );

  const markdown = formatCiReport(report, "markdown");

  assert.match(markdown, /# Renma CI Report/);
  assert.match(
    markdown,
    /- Status: FAIL — blocking repository-governance regression detected/,
  );
  assert.match(markdown, /- Range: `main` -> `HEAD`/);
  assert.match(markdown, /- New unresolved required edges: 1/);
  assert.match(
    markdown,
    /- HIGH `MAINT-REPEATED-CODE-BLOCK` `docs\/guide.md:L12` — Repeated code block/,
  );
  assert.match(
    markdown,
    /- MEDIUM `DOC-NO-LINE` `docs\/no-line.md` — Finding without line/,
  );
  assert.match(
    markdown,
    /- MEDIUM `DOC-NO-PATH` `unknown` — Finding without path/,
  );
  assert.match(markdown, /- 2 more not shown; see JSON for the full list\./);
  assert.match(markdown, /Review new unresolved required edges before merge\./);
});

test("formatCiReport renders structured JSON", () => {
  const json = formatCiReport(sampleReport(), "json");
  const parsed = JSON.parse(json) as CiReport;

  assert.equal(parsed.status, "fail");
  assert.equal(parsed.summary.highOrCriticalFindingsDelta, 1);
  assert.equal(parsed.diff.findings.added[0]?.id, "MAINT-REPEATED-CODE-BLOCK");
});

test("ci report policy fails new high finding even when high/critical net delta is zero", () => {
  const report = policyDiffReport({
    addedFindings: [finding("MAINT-NEW-HIGH", "high")],
    summary: {
      findingsDelta: 0,
      highOrCriticalFindingsDelta: 0,
    },
  });

  assert.equal(determineCiReportStatus(report), "fail");
});

test("ci report policy fails new critical finding", () => {
  const report = policyDiffReport({
    addedFindings: [finding("SEC-NEW-CRITICAL", "critical")],
  });

  assert.equal(determineCiReportStatus(report), "fail");
});

test("ci report policy fails new unresolved required edge", () => {
  const report = policyDiffReport({
    newUnresolvedEdges: [
      {
        source: "skills/demo/SKILL.md",
        target: "docs/required.md",
        kind: "requires",
      },
    ],
  });

  assert.equal(determineCiReportStatus(report), "fail");
});

test("ci report policy does not fail unresolved optional edge", () => {
  const report = policyDiffReport({
    newUnresolvedEdges: [
      {
        source: "skills/demo/SKILL.md",
        target: "docs/optional.md",
        kind: "optional",
      },
    ],
  });

  assert.equal(determineCiReportStatus(report), "pass");
});

test("ci report policy does not warn on total asset decrease alone", () => {
  const report = policyDiffReport({
    summary: {
      totalAssetsDelta: -3,
    },
  });

  assert.equal(determineCiReportStatus(report), "pass");
});

test("ci report policy passes readiness check changes when visible signals improve", () => {
  const report = policyDiffReport({
    summary: {
      readinessScoreDelta: 91,
      ownershipCoverageDelta: 82,
      findingsDelta: -158,
      highOrCriticalFindingsDelta: 0,
    },
    checkChanges: [
      {
        id: "workflow.required_context",
        title: "Required context",
        fromStatus: "fail",
        toStatus: "pass",
        fromSeverity: "error",
        toSeverity: "info",
        summaryChanged: true,
      },
    ],
  });

  assert.equal(determineCiReportStatus(report), "pass");
});

test("ci report policy warns on ownership coverage decrease", () => {
  const report = policyDiffReport({
    summary: {
      ownershipCoverageDelta: -1,
    },
  });

  assert.equal(determineCiReportStatus(report), "warn");
});

test("ci report policy warns on graph resolution decrease", () => {
  const report = policyDiffReport({
    summary: {
      graphResolutionDelta: -1,
    },
  });

  assert.equal(determineCiReportStatus(report), "warn");
});

test("ci report policy warns on finding increase", () => {
  const report = policyDiffReport({
    summary: {
      findingsDelta: 1,
    },
  });

  assert.equal(determineCiReportStatus(report), "warn");
});

test("ci report policy warns on readiness score decrease", () => {
  const report = policyDiffReport({
    summary: {
      readinessScoreDelta: -1,
    },
  });

  assert.equal(determineCiReportStatus(report), "warn");
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
            source: "skills/demo/SKILL.md",
            target: "docs/guide.md",
            kind: "requires",
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

function policyDiffReport(options: {
  addedFindings?: unknown[];
  newUnresolvedEdges?: unknown[];
  summary?: Partial<CiReport["summary"]>;
  checkChanges?: unknown[];
}): CiReport["diff"] {
  return {
    root: "/repo",
    from: {
      ref: "main",
      scannedFileCount: 8,
      totalAssets: 10,
      readinessScore: 80,
      readinessLevel: "needs_attention",
    },
    to: {
      ref: "HEAD",
      scannedFileCount: 8,
      totalAssets: 10,
      readinessScore: 80,
      readinessLevel: "needs_attention",
    },
    summary: {
      readinessScoreDelta: 0,
      readinessLevelChanged: false,
      totalAssetsDelta: 0,
      ownershipCoverageDelta: 0,
      graphResolutionDelta: 0,
      findingsDelta: 0,
      highOrCriticalFindingsDelta: 0,
      ...options.summary,
    },
    catalog: {
      addedAssets: [],
      removedAssets: [],
      changedAssets: [],
    },
    graph: {
      addedEdges: [],
      removedEdges: [],
      newUnresolvedEdges: options.newUnresolvedEdges ?? [],
      resolvedEdges: [],
    },
    readiness: {
      checkChanges: options.checkChanges ?? [],
    },
    findings: {
      added: options.addedFindings ?? [],
      removed: [],
      countById: [],
    },
  } as unknown as CiReport["diff"];
}

function finding(id: string, severity: string) {
  return {
    id,
    severity,
    title: "Policy finding",
    evidence: {
      path: "docs/policy.md",
      startLine: 1,
    },
  };
}
