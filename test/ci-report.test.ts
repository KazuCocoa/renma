import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import fc from "fast-check";
import {
  buildCiReportFromDiff,
  ciReport,
  determineCiReportStatus,
  formatCiReport,
  runCiReportCommand,
  type CiReport,
  type CiReportFormatInput,
} from "../src/commands/ci-report.js";
import type { DiffReport } from "../src/commands/diff.js";
import { zeroContextLensSummary } from "../src/context-lens.js";
import { scan } from "../src/scanner.js";
import {
  summarizeSecurityPosture,
  zeroSecurityPostureSummary,
} from "../src/security-posture.js";
import { buildSecurityDiffSummary } from "../src/security-diff.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../src/security-policy-inventory.js";

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
  assert.equal(parsed.diff.security.posture.added.totalSecurityFindings, 0);
  assert.equal(parsed.diff.security.policyInventory.totalPolicyAssets, 5);
  assert.equal(parsed.securityPosture.added.totalSecurityFindings, 0);
  assert.equal(
    parsed.skillDiscovery.schemaVersion,
    "renma.skill-discovery-diff.v1",
  );
  assert.equal("discovery" in parsed.diff, false);
  assert.equal(
    parsed.to.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    3,
  );
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

test("formatCiReport includes target security policy inventory", () => {
  const report = sampleReport();
  const parsed = JSON.parse(formatCiReport(report, "json")) as CiReport;
  const markdown = formatCiReport(report, "markdown");

  assert.equal(
    parsed.to.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    3,
  );
  assert.equal(
    parsed.to.securityPolicyInventory?.assetsWithoutEffectivePolicy,
    1,
  );
  assert.match(markdown, /^## Security Policy Inventory$/m);
  assert.match(markdown, /- Target assets with local policy metadata: 3/);
  assert.match(markdown, /- Target assets without effective policy: 1/);
  assert.match(markdown, /- Target referenced security profiles: 2/);
  assert.match(markdown, /- Target missing security profiles: 1/);
  assert.match(markdown, /- Target approved network destinations: 4/);
  assert.match(markdown, /- Target approved upload destinations: 2/);
});

test("formatCiReport includes security changes from the semantic diff", () => {
  const report = sampleReport();
  const fromInventory = policyInventory({
    totalPolicyAssets: 3,
    assetsWithLocalPolicyMetadata: 2,
    assetsWithoutEffectivePolicy: 2,
    missingSecurityProfiles: 0,
  });
  const toInventory = policyInventory({
    totalPolicyAssets: 5,
    assetsWithLocalPolicyMetadata: 4,
    assetsWithoutEffectivePolicy: 1,
    missingSecurityProfiles: 1,
  });
  report.diff.findings.added = [
    finding("SEC-LITERAL-SECRET", "high", "violation"),
  ];
  report.diff.findings.removed = [
    finding("SEC-MISSING-POLICY-METADATA", "medium", "advisory"),
  ];
  report.diff.from.securityPolicyInventory = fromInventory;
  report.diff.to.securityPolicyInventory = toInventory;
  report.diff.security = buildSecurityDiffSummary({
    addedFindings: report.diff.findings.added,
    removedFindings: report.diff.findings.removed,
    fromPolicyInventory: fromInventory,
    toPolicyInventory: toInventory,
  });

  const parsed = JSON.parse(formatCiReport(report, "json")) as CiReport;
  const markdown = formatCiReport(report, "markdown");

  assert.equal(parsed.diff.security.posture.added.totalSecurityFindings, 1);
  assert.equal(parsed.diff.security.posture.resolved.totalSecurityFindings, 1);
  assert.equal(parsed.diff.security.policyInventory.totalPolicyAssets, 2);
  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 1/);
  assert.match(markdown, /- Resolved security findings: 1/);
  assert.match(markdown, /- Added violations: 1/);
  assert.match(markdown, /- Policy assets: \+2/);
  assert.match(markdown, /- Assets with local policy metadata: \+2/);
  assert.match(markdown, /- Assets without effective policy: -1/);
  assert.match(markdown, /- Missing security profiles: \+1/);
});

test("formatCiReport tolerates legacy fixtures without security diff", () => {
  const report = sampleReport();
  delete (report.diff as Partial<CiReport["diff"]>).security;

  const markdown = formatCiReport(report, "markdown");

  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 0/);
  assert.match(markdown, /- Policy assets: \+0/);
});

test("formatCiReport preserves legacy CI reports without Skill Discovery", () => {
  const current = sampleReport();
  const { skillDiscovery, ...legacyReport } = current;
  void skillDiscovery;
  const legacy: CiReportFormatInput = legacyReport;
  const before = JSON.stringify(legacy);

  const json = formatCiReport(legacy, "json");
  const markdown = formatCiReport(legacy, "markdown");

  assert.equal(JSON.stringify(legacy), before);
  assert.equal("skillDiscovery" in JSON.parse(json), false);
  assert.doesNotMatch(markdown, /Skill Discovery/);
  assert.match(markdown, /^## Security Posture$/m);
  assert.match(markdown, /^## Review Notes$/m);
});

test("formatCiReport renders bounded neutral Skill Discovery changes", () => {
  const report = sampleReport();
  report.skillDiscovery = representativeSkillDiscoveryDiff();

  const markdown = formatCiReport(report, "markdown");

  assert.match(markdown, /^## Skill Discovery Changes$/m);
  assert.match(markdown, /- Schema: renma\.skill-discovery-diff\.v1/);
  assert.match(markdown, /- CI policy effect: none \(observation only\)/);
  assert.match(markdown, /- Adoption: partial -> adopted/);
  assert.match(markdown, /- Coverage: descriptive -> authoritative/);
  assert.match(markdown, /- Published entrypoints: \+1 \/ -0/);
  assert.match(markdown, /- Reachability: \+1 reachable \/ \+1 not-reached/);
  assert.match(markdown, /- Routes: \+0 \/ -0 \/ 1 changed/);
  assert.match(markdown, /^### Added published entrypoints$/m);
  assert.match(markdown, /^### Newly not-reached Skills$/m);
  assert.match(markdown, /^### Changed routes$/m);
  assert.match(markdown, /^### Added cyclic components$/m);
  assert.ok(
    markdown.indexOf("## Semantic Diff") <
      markdown.indexOf("## Skill Discovery Changes"),
  );
  assert.ok(
    markdown.indexOf("## Skill Discovery Changes") <
      markdown.indexOf("## Security Posture"),
  );
});

test("formatCiReport renders a stable no-change Skill Discovery section", () => {
  const markdown = formatCiReport(sampleReport(), "markdown");
  const discoverySection = markdown.slice(
    markdown.indexOf("## Skill Discovery Changes"),
    markdown.indexOf("## Security Posture"),
  );

  assert.match(discoverySection, /^## Skill Discovery Changes$/m);
  assert.match(discoverySection, /- No Skill Discovery topology changes\./);
  assert.doesNotMatch(
    discoverySection,
    /^### (?:Added|Removed|Newly|Resolved)/m,
  );
});

test("formatCiReport caps Skill Discovery detail lists", () => {
  const report = sampleReport();
  report.skillDiscovery.publishedEntrypoints.added = Array.from(
    { length: 12 },
    (_, index) => ({
      id: `skill.${index}`,
      path: `skills/${index}/SKILL.md`,
    }),
  );
  report.skillDiscovery.summary.publishedEntrypointCountDelta = 12;

  const markdown = formatCiReport(report, "markdown");

  assert.match(markdown, /- 2 more not shown; see JSON for the full list\./);
  assert.doesNotMatch(markdown, /skill\.10 \(/);
  assert.equal(report.skillDiscovery.publishedEntrypoints.added.length, 12);
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

test("ci report policy inventory counts do not change CI status", () => {
  const report = policyDiffReport({});
  const fromInventory = policyInventory({ totalPolicyAssets: 1 });
  const toInventory = targetSecurityPolicyInventory();
  report.from.securityPolicyInventory = fromInventory;
  report.to.securityPolicyInventory = toInventory;
  report.security = buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
    fromPolicyInventory: fromInventory,
    toPolicyInventory: toInventory,
  });

  assert.equal(determineCiReportStatus(report), "pass");
});

test("ci report policy fails blocking Context Lens diagnostics", () => {
  const report = policyDiffReport({});
  report.to.contextLens = {
    ...zeroContextLensSummary(),
    detected: true,
    totalLensCount: 1,
    invalidLensCount: 1,
    diagnosticCounts: {
      error: 1,
      warning: 0,
      info: 0,
    },
  };

  assert.equal(determineCiReportStatus(report), "fail");
});

test("buildCiReportFromDiff is pure, deterministic, and keeps Discovery outside nested diff", () => {
  const complete = completeDiffReport(representativeSkillDiscoveryDiff());
  const before = JSON.stringify(complete);

  const first = buildCiReportFromDiff(complete);
  const second = buildCiReportFromDiff(complete);

  assert.equal(JSON.stringify(complete), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.skillDiscovery, complete.discovery);
  assert.equal(first.skillDiscovery, complete.discovery);
  assert.equal("discovery" in first.diff, false);
  assert.equal(first.status, determineCiReportStatus(first.diff));
});

test("a route becoming unresolved and unusable remains one neutral changed route", () => {
  const discovery = representativeSkillDiscoveryDiff();
  discovery.adoption = {
    from: "adopted",
    to: "adopted",
    changed: false,
  };
  discovery.coverage = {
    from: "authoritative",
    to: "authoritative",
    changed: false,
  };
  discovery.publishedEntrypoints.added = [];
  discovery.reachability.newlyReachable = [];
  discovery.reachability.newlyNotReached = [];
  discovery.cycles.added = [];
  const report = buildCiReportFromDiff({
    ...policyDiffReport({}),
    discovery,
  });

  assert.equal(report.skillDiscovery.routes.changed.length, 1);
  assert.deepEqual(report.skillDiscovery.routes.changed[0]?.identity, {
    sourcePath: "skills/entry/SKILL.md",
    normalizedTarget: "skill.target",
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(report.notes, ["No CI report regressions detected."]);
  assert.equal("discovery" in report.diff, false);
});

test("existing blocking policy still fails when Discovery changes", () => {
  const compatible = policyDiffReport({
    addedFindings: [finding("SEC-NEW-CRITICAL", "critical", "violation")],
    summary: {
      findingsDelta: 1,
      highOrCriticalFindingsDelta: 1,
    },
  });
  const report = buildCiReportFromDiff({
    ...compatible,
    discovery: representativeSkillDiscoveryDiff(),
  });

  assert.equal(report.status, "fail");
  assert.ok(
    report.notes.includes("Review new high or critical findings before merge."),
  );
  assert.ok(!report.notes.some((note) => /Discovery/i.test(note)));
  assert.equal("discovery" in report.diff, false);
});

test("CI status and notes are invariant under arbitrary Discovery-only changes", () => {
  const compatible = sampleReport().diff;

  fc.assert(
    fc.property(
      fc.boolean(),
      fc.integer({ min: -100, max: 100 }),
      fc.integer({ min: 0, max: 20 }),
      (changed, delta, itemCount) => {
        const firstDiscovery = neutralSkillDiscoveryDiff();
        const secondDiscovery = neutralSkillDiscoveryDiff();
        secondDiscovery.adoption = {
          from: "partial",
          to: changed ? "adopted" : "partial",
          changed,
        };
        secondDiscovery.coverage = {
          from: "descriptive",
          to: changed ? "authoritative" : "descriptive",
          changed,
        };
        secondDiscovery.summary.reachableSkillCountDelta = delta;
        secondDiscovery.reachability.newlyNotReached = Array.from(
          { length: itemCount },
          (_, index) => ({
            id: `skill.${index}`,
            path: `skills/${index}/SKILL.md`,
          }),
        );

        const first = buildCiReportFromDiff({
          ...compatible,
          discovery: firstDiscovery,
        });
        const second = buildCiReportFromDiff({
          ...compatible,
          discovery: secondDiscovery,
        });

        assert.equal(first.status, second.status);
        assert.deepEqual(first.notes, second.notes);
        assert.equal("discovery" in first.diff, false);
        assert.equal("discovery" in second.diff, false);
      },
    ),
    { seed: 232, numRuns: 100 },
  );
});

test("representative CI report matches the public JSON golden", async () => {
  const report = buildCiReportFromDiff(
    completeDiffReport(representativeSkillDiscoveryDiff()),
  );
  const golden = await readFile(
    join(process.cwd(), "test/fixtures/ci-report.golden"),
    "utf8",
  );
  const json = formatCiReport(report, "json");

  assert.equal(json, golden);
  assert.equal(
    report.skillDiscovery.schemaVersion,
    "renma.skill-discovery-diff.v1",
  );
  assert.equal("discovery" in report.diff, false);
  assert.doesNotMatch(
    JSON.stringify(report.skillDiscovery),
    /diagnostics|declarationIndex|startLine|endLine|snippet|renma-diff-/,
  );
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
    assert.equal("discovery" in report.diff, false);
    assert.equal(
      "discovery" in
        (JSON.parse(json) as { diff: Record<string, unknown> }).diff,
      false,
    );
    assert.match(markdown, /^## Skill Discovery Changes$/m);
    assert.doesNotMatch(markdown, /SEC-LITERAL-SECRET/);
    assert.doesNotMatch(json, /SEC-LITERAL-SECRET/);
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("ci report prepares Skill Discovery once for both refs", async () => {
  const repo = await createSuppressedFindingRepo();
  const counts = {
    from: instrumentationCounts(),
    to: instrumentationCounts(),
  };
  try {
    const report = await ciReport(repo, {
      fromRef: "base",
      toRef: "HEAD",
      instrumentation: {
        from: instrumentation(counts.from),
        to: instrumentation(counts.to),
      },
    });
    const markdown = formatCiReport(report, "markdown");
    const json = JSON.parse(formatCiReport(report, "json")) as CiReport;
    const command = await withCapturedStdout(() =>
      runCiReportCommand(repo, {
        fromRef: "base",
        toRef: "HEAD",
        format: "json",
      }),
    );
    const commandJson = JSON.parse(command.stdout) as CiReport;

    for (const refCounts of [counts.from, counts.to]) {
      assert.equal(refCounts.discovery, 1);
      assert.equal(refCounts.parsedPaths.length, 1);
      assert.equal(
        refCounts.parsedPaths.length,
        new Set(refCounts.parsedPaths).size,
      );
      assert.equal(refCounts.projections.get("catalog"), 1);
      assert.equal(refCounts.projections.get("agent-skills"), 1);
      assert.equal(refCounts.projections.get("skill-discovery"), 1);
    }
    assert.equal(report.status, "pass");
    assert.deepEqual(report.notes, ["No CI report regressions detected."]);
    assert.equal(command.code, 0);
    assert.equal(commandJson.status, report.status);
    assert.deepEqual(commandJson.notes, report.notes);
    assert.equal("discovery" in report.diff, false);
    assert.equal("discovery" in json.diff, false);
    assert.equal("discovery" in commandJson.diff, false);
    assert.equal(
      report.skillDiscovery.schemaVersion,
      "renma.skill-discovery-diff.v1",
    );
    assert.deepEqual(report.skillDiscovery, neutralSkillDiscoveryDiff());
    assert.deepEqual(commandJson.skillDiscovery, report.skillDiscovery);
    assert.match(markdown, /^## Skill Discovery Changes$/m);
    assert.match(markdown, /- No Skill Discovery topology changes\./);
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("ci report fails when target ref has blocking Context Lens diagnostics", async () => {
  const repo = await createContextLensDiagnosticRepo();
  try {
    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
    const json = JSON.parse(formatCiReport(report, "json")) as CiReport;
    const command = await withCapturedStdout(() =>
      runCiReportCommand(repo, {
        fromRef: "base",
        toRef: "HEAD",
        format: "json",
      }),
    );
    const commandJson = JSON.parse(command.stdout) as CiReport;

    assert.equal(report.status, "fail");
    assert.equal(command.code, 1);
    assert.equal(json.to.contextLens?.invalidLensCount, 1);
    assert.equal(json.to.contextLens?.diagnosticCounts.error, 1);
    assert.equal(commandJson.to.contextLens?.diagnosticCounts.error, 1);
    assert.ok(
      report.notes.includes(
        "Review blocking Context Lens diagnostics before merge.",
      ),
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

function sampleReport(): CiReport {
  const targetInventory = targetSecurityPolicyInventory();
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
      securityPolicyInventory: targetInventory,
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
    skillDiscovery: neutralSkillDiscoveryDiff(),
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
        securityPolicyInventory: targetInventory,
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
      security: buildSecurityDiffSummary({
        addedFindings: [
          {
            id: "MAINT-REPEATED-CODE-BLOCK",
            severity: "high",
          },
        ],
        removedFindings: [],
        toPolicyInventory: targetInventory,
      }),
    } as unknown as CiReport["diff"],
  };
}

function completeDiffReport(discovery: CiReport["skillDiscovery"]): DiffReport {
  return {
    ...policyDiffReport({}),
    discovery,
  };
}

function neutralSkillDiscoveryDiff(): CiReport["skillDiscovery"] {
  return {
    schemaVersion: "renma.skill-discovery-diff.v1",
    adoption: {
      from: "not-adopted",
      to: "not-adopted",
      changed: false,
    },
    coverage: {
      from: "not-evaluated",
      to: "not-evaluated",
      changed: false,
    },
    summary: {
      publishedEntrypointCountDelta: 0,
      routeEligibleSkillCountDelta: 0,
      reachableSkillCountDelta: 0,
      notReachedSkillCountDelta: 0,
      unroutedSkillCountDelta: 0,
      usableRouteCountDelta: 0,
      unusableRouteCountDelta: 0,
      unresolvedRouteCountDelta: 0,
      cycleComponentCountDelta: 0,
    },
    publishedEntrypoints: {
      added: [],
      removed: [],
    },
    reachability: {
      newlyReachable: [],
      newlyNotReached: [],
    },
    unroutedSkills: {
      newlyUnrouted: [],
      resolvedUnrouted: [],
    },
    routes: {
      added: [],
      removed: [],
      changed: [],
    },
    cycles: {
      added: [],
      resolved: [],
    },
  };
}

function representativeSkillDiscoveryDiff(): CiReport["skillDiscovery"] {
  const discovery = neutralSkillDiscoveryDiff();
  const routeFrom = {
    sourceId: "skill.entry",
    sourcePath: "skills/entry/SKILL.md",
    normalizedTarget: "skill.target",
    declarationCount: 1,
    resolution: "resolved" as const,
    candidates: [],
    resolvedTarget: {
      id: "skill.target",
      path: "skills/target/SKILL.md",
      kind: "skill",
      lifecycle: "stable",
    },
    usable: true,
    usabilityReasons: [],
  };
  const { resolvedTarget, ...routeWithoutResolvedTarget } = routeFrom;
  void resolvedTarget;
  const routeTo = {
    ...routeWithoutResolvedTarget,
    resolution: "unresolved" as const,
    usable: false,
    usabilityReasons: ["unresolved-target"] as Array<"unresolved-target">,
  };

  return {
    ...discovery,
    adoption: {
      from: "partial",
      to: "adopted",
      changed: true,
    },
    coverage: {
      from: "descriptive",
      to: "authoritative",
      changed: true,
    },
    summary: {
      ...discovery.summary,
      publishedEntrypointCountDelta: 1,
      reachableSkillCountDelta: 1,
      notReachedSkillCountDelta: 1,
      usableRouteCountDelta: -1,
      unusableRouteCountDelta: 1,
      unresolvedRouteCountDelta: 1,
      cycleComponentCountDelta: 1,
    },
    publishedEntrypoints: {
      added: [{ id: "skill.entry", path: "skills/entry/SKILL.md" }],
      removed: [],
    },
    reachability: {
      newlyReachable: [{ id: "skill.target", path: "skills/target/SKILL.md" }],
      newlyNotReached: [{ id: "skill.orphan", path: "skills/orphan/SKILL.md" }],
    },
    routes: {
      added: [],
      removed: [],
      changed: [
        {
          identity: {
            sourcePath: routeFrom.sourcePath,
            normalizedTarget: routeFrom.normalizedTarget,
          },
          changedFields: [
            "resolution",
            "resolvedTarget",
            "usable",
            "usabilityReasons",
          ],
          from: routeFrom,
          to: routeTo,
        },
      ],
    },
    cycles: {
      added: [
        {
          skillIds: ["skill.entry", "skill.target"],
          skills: [
            { id: "skill.entry", path: "skills/entry/SKILL.md" },
            { id: "skill.target", path: "skills/target/SKILL.md" },
          ],
          selfLoop: false,
        },
      ],
      resolved: [],
    },
  };
}

function targetSecurityPolicyInventory(): SecurityPolicyInventorySummary {
  return policyInventory({
    totalPolicyAssets: 5,
    assetsWithLocalPolicyMetadata: 3,
    assetsWithoutEffectivePolicy: 1,
    approvedNetworkDestinationCount: 4,
    approvedUploadDestinationCount: 2,
    referencedSecurityProfiles: 2,
    missingSecurityProfiles: 1,
  });
}

interface PolicyInventoryInput {
  totalPolicyAssets?: number | undefined;
  assetsWithLocalPolicyMetadata?: number | undefined;
  assetsWithoutEffectivePolicy?: number | undefined;
  approvedNetworkDestinationCount?: number | undefined;
  approvedUploadDestinationCount?: number | undefined;
  referencedSecurityProfiles?: number | undefined;
  missingSecurityProfiles?: number | undefined;
}

function policyInventory(
  input: PolicyInventoryInput,
): SecurityPolicyInventorySummary {
  const inventory = zeroSecurityPolicyInventorySummary();
  inventory.totalPolicyAssets = input.totalPolicyAssets ?? 0;
  inventory.assetsWithLocalPolicyMetadata =
    input.assetsWithLocalPolicyMetadata ?? 0;
  inventory.assetsWithoutEffectivePolicy =
    input.assetsWithoutEffectivePolicy ?? 0;
  inventory.approvedNetworkDestinationCount =
    input.approvedNetworkDestinationCount ?? 0;
  inventory.approvedUploadDestinationCount =
    input.approvedUploadDestinationCount ?? 0;
  inventory.securityProfiles.referenced = input.referencedSecurityProfiles ?? 0;
  inventory.securityProfiles.missing = input.missingSecurityProfiles ?? 0;
  return inventory;
}

function policyDiffReport(options: {
  addedFindings?: Array<ReturnType<typeof finding>>;
  newUnresolvedEdges?: unknown[];
  summary?: Partial<CiReport["summary"]>;
  checkChanges?: unknown[];
}): CiReport["diff"] {
  const addedFindings = options.addedFindings ?? [];
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
      added: addedFindings,
      removed: [],
      countById: [],
    },
    security: buildSecurityDiffSummary({
      addedFindings,
      removedFindings: [],
    }),
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

async function createContextLensDiagnosticRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-ci-context-lens-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeContext(repo);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["tag", "base"]);

  await writeInvalidContextLens(repo);
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

async function writeContext(repo: string): Promise<void> {
  const directory = join(repo, "contexts", "testing");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "boundary-value-analysis.md"),
    [
      "---",
      "id: context.testing.boundary-value-analysis",
      "owner: qa-platform",
      "status: stable",
      "allowed_data: public",
      "network_allowed: false",
      "external_upload_allowed: false",
      "secrets_allowed: false",
      "when_to_use:",
      "  - Designing tests around numeric, date, quantity, or limit boundaries",
      "when_not_to_use:",
      "  - Exploratory notes unrelated to limits",
      "---",
      "# Boundary Value Analysis",
      "",
      "Use this context to review explicit boundaries.",
      "",
    ].join("\n"),
  );
}

async function writeInvalidContextLens(repo: string): Promise<void> {
  const directory = join(repo, "lenses", "testing");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "spec-review.md"),
    [
      "---",
      "id: lens.testing.spec-review",
      "owner: qa-platform",
      "status: experimental",
      "applies_to:",
      "  - context.testing.boundary-value-analysis",
      "---",
      "# Spec Review Lens",
      "",
      "Review boundary context for ambiguity.",
      "",
    ].join("\n"),
  );
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

async function withCapturedStdout(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string }> {
  const stdoutWrite = process.stdout.write;
  let stdout = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    const code = await callback();
    return { code, stdout };
  } finally {
    process.stdout.write = stdoutWrite;
  }
}

interface InstrumentationCounts {
  discovery: number;
  parsedPaths: string[];
  projections: Map<string, number>;
}

function instrumentationCounts(): InstrumentationCounts {
  return {
    discovery: 0,
    parsedPaths: [],
    projections: new Map(),
  };
}

function instrumentation(counts: InstrumentationCounts) {
  return {
    onDiscovery() {
      counts.discovery += 1;
    },
    onDocumentParse(path: string) {
      counts.parsedPaths.push(path);
    },
    onProjection(name: string) {
      counts.projections.set(name, (counts.projections.get(name) ?? 0) + 1);
    },
  };
}
