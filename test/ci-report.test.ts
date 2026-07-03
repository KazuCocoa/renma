import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ciReport,
  determineCiReportStatus,
  formatCiReport,
  type CiReport,
} from "../src/commands/ci-report.js";
import { scan } from "../src/scanner.js";
import {
  summarizeSecurityPosture,
  zeroSecurityPostureSummary,
} from "../src/security-posture.js";

const execFile = promisify(execFileCallback);

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
  assert.equal(parsed.securityPosture.added.totalSecurityFindings, 0);
});

test("formatCiReport includes security posture summaries", () => {
  const report = sampleReport();
  report.diff.findings.added = [
    finding("SEC-LITERAL-SECRET", "high", "violation"),
    finding("QUAL-MISSING-EXAMPLES", "high"),
  ];
  report.diff.findings.removed = [
    finding("SEC-MISSING-POLICY-METADATA", "medium", "advisory"),
  ];
  report.securityPosture = {
    added: summarizeSecurityPosture(report.diff.findings.added),
    resolved: summarizeSecurityPosture(report.diff.findings.removed),
  };

  const parsed = JSON.parse(formatCiReport(report, "json")) as CiReport;
  const markdown = formatCiReport(report, "markdown");

  assert.equal(parsed.securityPosture.added.totalSecurityFindings, 1);
  assert.equal(parsed.securityPosture.added.riskClasses.violation, 1);
  assert.equal(parsed.securityPosture.added.highOrCritical, 1);
  assert.equal(parsed.securityPosture.resolved.totalSecurityFindings, 1);
  assert.equal(parsed.securityPosture.resolved.riskClasses.advisory, 1);
  assert.match(markdown, /^## Security Posture$/m);
  assert.match(markdown, /- Added security findings: 1/);
  assert.match(markdown, /- Added violations: 1/);
  assert.match(markdown, /- Resolved security findings: 1/);
  assert.match(markdown, /- Resolved advisory: 1/);
});

test("formatCiReport renders finding risk classes when present", () => {
  const report = sampleReport();
  report.diff.findings.added[0] = {
    id: "SEC-LITERAL-SECRET",
    severity: "high",
    riskClass: "violation",
    title: "Literal credential-like value appears in repository text",
    evidence: {
      path: "skills/demo/SKILL.md",
      startLine: 4,
    },
  };

  const markdown = formatCiReport(report, "markdown");

  assert.match(
    markdown,
    /- HIGH \[violation\] `SEC-LITERAL-SECRET` `skills\/demo\/SKILL\.md:L4`/,
  );
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

test("ci report omits suppressed high findings introduced between git refs", async () => {
  const repo = await createSuppressedFindingRepo();
  try {
    const headScan = await scan(repo, { format: "json" });
    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
    const markdown = formatCiReport(report, "markdown");
    const json = formatCiReport(report, "json");

    assert.equal(headScan.scannedFileCount, 1);
    assert.ok(
      !headScan.findings.some((finding) => finding.id === "SEC-LITERAL-SECRET"),
    );
    assert.ok(
      !report.diff.findings.added.some(
        (finding) => finding.id === "SEC-LITERAL-SECRET",
      ),
    );
    assert.equal(report.summary.findingsDelta, 0);
    assert.equal(report.summary.highOrCriticalFindingsDelta, 0);
    assert.notEqual(report.status, "fail");
    assert.doesNotMatch(markdown, /SEC-LITERAL-SECRET/);
    assert.doesNotMatch(json, /SEC-LITERAL-SECRET/);
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
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
    securityPosture: {
      added: zeroSecurityPostureSummary(),
      resolved: zeroSecurityPostureSummary(),
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

function finding(id: string, severity: string, riskClass?: string) {
  return {
    id,
    severity,
    ...(riskClass ? { riskClass } : {}),
    title: "Policy finding",
    evidence: {
      path: "docs/policy.md",
      startLine: 1,
    },
  };
}

async function createSuppressedFindingRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-ci-suppression-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeFile(
    join(repo, "renma.config.json"),
    JSON.stringify({
      suppressions: [
        {
          id: "SEC-LITERAL-SECRET",
          paths: ["skills/demo/**"],
          reason: "Fixture intentionally introduces a fake secret.",
          expires: "never",
        },
      ],
    }),
  );
  await writeSkill(repo, "");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["tag", "base"]);

  await writeSkill(repo, '\napi_key = "abcd1234abcd1234"\n');
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "head"]);
  return repo;
}

async function writeSkill(repo: string, extraBody: string): Promise<void> {
  const directory = join(repo, "skills", "demo");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    [
      "---",
      "id: demo",
      "name: demo",
      "owner: qa-platform",
      "status: stable",
      "description: Use this skill for demo requests when routing clarity, examples, preflight checks, required inputs, completion criteria, and verification are needed.",
      "allowed_data: public",
      "network_allowed: false",
      "external_upload_allowed: false",
      "secrets_allowed: false",
      "---",
      "# Demo",
      "Use this skill when a demo request needs a deterministic workflow.",
      "",
      "## Do Not Use For",
      "Do not use for production incidents.",
      "",
      "## Instructions",
      "1. Collect task context.",
      "2. Verify the result.",
      "",
      "## Required Inputs",
      "- A demo request.",
      "",
      "## Completion Criteria",
      "- The result is verified.",
      "",
      "## Examples",
      "Input: demo request.",
      "Output: demo result.",
      "",
      "## Preflight",
      "Check the target path.",
      "",
      "## Verification",
      "Run renma scan.",
      extraBody,
    ].join("\n"),
  );
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args]);
  return stdout.trim();
}
