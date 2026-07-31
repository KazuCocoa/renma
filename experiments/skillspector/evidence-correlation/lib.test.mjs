import assert from "node:assert/strict";
import test from "node:test";
import {
  correlateTarget,
  evaluateExperimentEvidence,
  normalizeEvidence,
  normalizeScannerTarget,
} from "./lib.mjs";
import { renderExperimentReport } from "./report.mjs";

const nativeDuplicate = {
  id: "AS3",
  finding_id: "finding-one",
  category: "Agent Snooping",
  pattern: "Skill Enumeration",
  severity: "MEDIUM",
  confidence: 0.8,
  location: { file: "./skills/demo/SKILL.md", start_line: 9, end_line: null },
  finding: "skills/Example/SKILL.md",
  explanation: "Scanner-native explanation.",
  remediation: "Scanner-native remediation.",
  code_snippet: null,
  intent: null,
  tags: ["Agent Snooping"],
};
const rawReport = {
  metadata: { skillspector_version: "2.5.0" },
  execution_successful: true,
  analysis_completeness: {
    execution_successful: true,
    is_complete: true,
    analyzer_statuses: [{ analyzer_id: "static", status: "completed" }],
  },
  issues: [
    nativeDuplicate,
    { ...structuredClone(nativeDuplicate), finding_id: "finding-two" },
    {
      id: "LP1",
      finding_id: "finding-three",
      severity: "HIGH",
      confidence: 0.75,
      location: { file: "README.md", start_line: null, end_line: null },
      explanation: "Unmatched evidence.",
      remediation: null,
    },
  ],
};
const catalog = {
  catalog: {
    assets: [
      {
        id: "skill.demo",
        kind: "skill",
        sourcePath: "skills/demo/SKILL.md",
        contentHash: "sha256:skill",
        ownership: {
          declaredOwner: "team-demo",
          effectiveOwner: "team-demo",
          source: "declared",
        },
      },
    ],
    dependencies: [],
  },
};

test("path normalization is deterministic and rejects unsafe targets", () => {
  assert.deepEqual(
    normalizeScannerTarget(".", { file: "./skills/demo/../demo/SKILL.md" }),
    {
      status: "normalized",
      scannerPath: "./skills/demo/../demo/SKILL.md",
      repositoryRelativePath: "skills/demo/SKILL.md",
      explanation:
        "The scanner path was normalized relative to the recorded scan target.",
    },
  );
  assert.equal(
    normalizeScannerTarget("skills/demo", { file: "../../outside.md" }).status,
    "unsafe",
  );
  assert.equal(
    normalizeScannerTarget(".", { file: "C:\\outside.md" }).status,
    "unsafe",
  );
  assert.equal(normalizeScannerTarget(".", null).status, "missing");
});

test("native fields, duplicates, provenance, and unresolved evidence survive", () => {
  const input = {
    rawReport,
    rawReportText: JSON.stringify(rawReport),
    rawOutputReference: "captured/report.json",
    catalog,
    catalogReference: "captured/catalog.json",
    catalogText: JSON.stringify(catalog),
    fixtureId: "unit-fixture",
  };
  const normalized = normalizeEvidence(input);

  assert.deepEqual(
    normalized.evidence[0].scannerFact.nativeFinding,
    nativeDuplicate,
  );
  assert.notEqual(
    normalized.evidence[0].scannerFact.nativeFinding,
    nativeDuplicate,
  );
  assert.equal(normalized.evidence[0].scannerFact.provenance, "scanner-output");
  assert.equal(
    normalized.evidence[0].normalization.provenance,
    "experiment-normalization",
  );
  assert.equal(
    normalized.evidence[0].correlation.provenance,
    "experiment-correlation",
  );
  assert.equal(normalized.evidence[0].correlation.status, "correlated");
  assert.deepEqual(
    normalized.evidence[0].correlation.directSkillAssociations.map(
      (association) => ({
        basis: association.basis,
        id: association.skill.id,
      }),
    ),
    [{ basis: "matched-asset-is-skill", id: "skill.demo" }],
  );
  assert.equal(normalized.evidence[2].correlation.status, "unresolved");
  assert.equal(
    normalized.evidence[2].correlation.reasonCode,
    "no-catalog-asset-at-path",
  );
  assert.equal(normalized.evidence.length, rawReport.issues.length);
  assert.deepEqual(
    normalized.observations.duplicateGroups[0].evidenceIndexes,
    [0, 1],
  );
  assert.equal(normalized.counts.duplicateEvidenceCount, 2);
  assert.equal(normalized.counts.correlatedCount, 2);
  assert.equal(normalized.counts.unresolvedCount, 1);
});

test("identical inputs produce byte-identical normalized JSON", () => {
  const input = {
    rawReport,
    rawReportText: JSON.stringify(rawReport),
    rawOutputReference: "captured/report.json",
    catalog,
    catalogReference: "captured/catalog.json",
    catalogText: JSON.stringify(catalog),
    fixtureId: "unit-fixture",
  };
  assert.equal(
    JSON.stringify(normalizeEvidence(input), null, 2),
    JSON.stringify(normalizeEvidence(input), null, 2),
  );
});

test("ambiguous exact paths remain ambiguous", () => {
  const target = normalizeScannerTarget(".", { file: "skills/demo/SKILL.md" });
  const duplicatedCatalog = {
    assets: [
      catalog.catalog.assets[0],
      { ...catalog.catalog.assets[0], id: "skill.demo.duplicate" },
    ],
    dependencies: [],
  };
  const result = correlateTarget(target, duplicatedCatalog);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("directly owned scripts associate only through exact ownership edges", () => {
  const script = {
    id: "skills/demo/scripts/probe.py",
    kind: "script",
    sourcePath: "skills/demo/scripts/probe.py",
    contentHash: "sha256:script",
    ownership: { source: "unowned" },
  };
  const directCatalog = {
    assets: [...catalog.catalog.assets, script],
    dependencies: [
      {
        from: "skill.demo",
        to: script.id,
        kind: "owns_local_resource",
        sourcePath: "skills/demo/SKILL.md",
      },
    ],
  };
  const result = correlateTarget(
    normalizeScannerTarget("skills/demo", { file: "scripts/probe.py" }),
    directCatalog,
  );
  assert.equal(result.status, "correlated");
  assert.deepEqual(
    result.directSkillAssociations.map((association) => ({
      basis: association.basis,
      id: association.skill.id,
      relationship: association.relationship,
    })),
    [
      {
        basis: "direct-owns-local-resource-edge",
        id: "skill.demo",
        relationship: directCatalog.dependencies[0],
      },
    ],
  );
});

test("evidence predicates accept a complete result matching the fixture", () => {
  const fixture = successfulFixture();
  const evaluation = evaluateExperimentEvidence(fixture);
  const report = renderExperimentReport(fixture);

  assert.equal(evaluation.allPredicatesSatisfied, true);
  assert.equal(
    evaluation.outcome,
    "proceed toward a scanner-specific adapter prototype",
  );
  assert.match(report, /All 10 explicit evidence predicates passed/u);
  assert.match(report, /Proceed toward a scanner-specific adapter prototype/u);
  assert.match(report, /matched-asset-is-skill/u);
  assert.match(report, /direct-owns-local-resource-edge/u);
});

test("zero findings cannot leave a stale positive report", () => {
  const fixture = successfulFixture({ issues: [] });
  const evaluation = evaluateExperimentEvidence(fixture);
  const report = renderExperimentReport(fixture);

  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(evaluation.failedCheckIds.includes("findings.present"));
  assert.doesNotMatch(report, /All \d+ explicit evidence predicates passed/u);
  assert.doesNotMatch(
    report,
    /Proceed toward a scanner-specific adapter prototype/u,
  );
  assert.match(report, /No raw finding was reported/u);
  assert.match(
    report,
    /Run another experiment before defining an adapter boundary/u,
  );
});

test("zero correlated findings remain inconclusive", () => {
  const original = successfulFixture().rawReport.issues;
  const fixture = successfulFixture({ issues: original.slice(2, 4) });
  const evaluation = evaluateExperimentEvidence(fixture);
  const report = renderExperimentReport(fixture);

  assert.equal(fixture.normalized.counts.correlatedCount, 0);
  assert.ok(evaluation.failedCheckIds.includes("correlations.present"));
  assert.match(report, /No successful correlation was observed/u);
  assert.doesNotMatch(
    report,
    /Proceed toward a scanner-specific adapter prototype/u,
  );
});

test("unexpected or mixed location precision fails the fixture predicate", () => {
  const issues = structuredClone(successfulFixture().rawReport.issues);
  issues[0].location.end_line = 1;
  const fixture = successfulFixture({ issues });
  const evaluation = evaluateExperimentEvidence(fixture);
  const report = renderExperimentReport(fixture);

  assert.ok(evaluation.failedCheckIds.includes("locations.expected-precision"));
  assert.match(report, /line-range: 1, start-line-only: 5/u);
  assert.doesNotMatch(
    report,
    /Proceed toward a scanner-specific adapter prototype/u,
  );
});

test("missing expected governed or ungoverned cases fails explicitly", () => {
  const issues = successfulFixture().rawReport.issues.filter(
    (issue) => issue.location.file !== "README.md",
  );
  const fixture = successfulFixture({ issues });
  const evaluation = evaluateExperimentEvidence(fixture);
  const report = renderExperimentReport(fixture);

  assert.ok(
    evaluation.failedCheckIds.includes(
      "target.unresolved:skills/evidence-fixture/README.md",
    ),
  );
  assert.ok(
    evaluation.failedCheckIds.includes("duplicates.expected-structure"),
  );
  assert.match(
    report,
    /Expected unresolved target skills\/evidence-fixture\/README\.md \| not satisfied \| 0 finding\(s\)/u,
  );
});

test("incomplete or unsuccessful producer analysis cannot pass", async (t) => {
  await t.test("incomplete and disabled", () => {
    const fixture = successfulFixture({
      completeness: {
        execution_successful: true,
        is_complete: false,
        analyzer_statuses: [{ analyzer_id: "semantic", status: "disabled" }],
      },
    });
    const evaluation = evaluateExperimentEvidence(fixture);
    const report = renderExperimentReport(fixture);
    assert.ok(evaluation.failedCheckIds.includes("producer.completeness"));
    assert.match(report, /Producer `is_complete` \| false/u);
    assert.match(report, /disabled: 1/u);
    assert.doesNotMatch(
      report,
      /Proceed toward a scanner-specific adapter prototype/u,
    );
  });

  await t.test("unsuccessful", () => {
    const fixture = successfulFixture({ executionSuccessful: false });
    const evaluation = evaluateExperimentEvidence(fixture);
    const report = renderExperimentReport(fixture);
    assert.ok(evaluation.failedCheckIds.includes("producer.execution"));
    assert.match(report, /Top-level execution successful \| false/u);
    assert.doesNotMatch(
      report,
      /Proceed toward a scanner-specific adapter prototype/u,
    );
  });
});

function successfulFixture(options = {}) {
  const skillPath = "skills/evidence-fixture/SKILL.md";
  const scriptPath = "skills/evidence-fixture/scripts/probe.py";
  const skill = {
    id: "skill.experiment.evidence-correlation",
    kind: "skill",
    sourcePath: skillPath,
    contentHash: "sha256:skill",
    ownership: {
      declaredOwner: "experiment-maintainers",
      effectiveOwner: "experiment-maintainers",
      source: "declared",
    },
  };
  const script = {
    id: scriptPath,
    kind: "script",
    sourcePath: scriptPath,
    contentHash: "sha256:script",
    ownership: {
      declaredOwner: null,
      effectiveOwner: "experiment-maintainers",
      source: "inherited",
    },
  };
  const defaultIssues = [
    fixtureIssue("LP1", "script-one", "scripts/probe.py", "file read"),
    fixtureIssue("LP1", "script-two", "scripts/probe.py", "network"),
    fixtureIssue("AS3", "readme-one", "README.md", "duplicate link"),
    fixtureIssue("AS3", "readme-two", "README.md", "duplicate link"),
    fixtureIssue("AS3", "skill-one", "SKILL.md", "duplicate link"),
    fixtureIssue("AS3", "skill-two", "SKILL.md", "duplicate link"),
  ];
  const issues = options.issues ?? defaultIssues;
  const completeness = options.completeness ?? {
    execution_successful: true,
    is_complete: true,
    analyzer_statuses: [{ analyzer_id: "static", status: "completed" }],
    limitations: [],
  };
  const fixtureReport = {
    skill: { scanned_at: "2026-01-01T00:00:00Z" },
    metadata: { skillspector_version: "test" },
    execution_successful: options.executionSuccessful ?? true,
    analysis_completeness: completeness,
    risk_assessment: { score: 1, severity: "NATIVE", recommendation: "OPAQUE" },
    issues,
  };
  const fixtureCatalog = {
    catalog: {
      assets: [skill, script],
      dependencies: [
        {
          from: skill.id,
          to: script.id,
          kind: "owns_local_resource",
          sourcePath: skill.sourcePath,
        },
        {
          from: skill.id,
          to: script.id,
          kind: "statically_references",
          sourcePath: skill.sourcePath,
        },
      ],
    },
  };
  const normalized = normalizeEvidence({
    rawReport: fixtureReport,
    rawReportText: JSON.stringify(fixtureReport),
    rawOutputReference: "captured/report.json",
    catalog: fixtureCatalog,
    catalogReference: "captured/catalog.json",
    catalogText: JSON.stringify(fixtureCatalog),
    fixtureId: "skillspector-evidence-correlation-v1",
    scannerTargetPath: "skills/evidence-fixture",
  });
  const invocation = {
    scanner: { executable: "skillspector", args: [], exitCode: 0 },
    renmaCatalog: { args: [] },
    renmaCli: { revision: "cli", executableSha256: "sha256:cli" },
    git: { headRevision: "head", worktreeState: "clean" },
    experimentHarness: { sha256: "sha256:harness", files: [] },
  };
  return {
    normalized,
    rawReport: fixtureReport,
    catalog: fixtureCatalog,
    invocation,
  };
}

function fixtureIssue(id, findingId, file, explanation) {
  return {
    id,
    finding_id: findingId,
    severity: "NATIVE",
    confidence: 0.5,
    location: { file, start_line: 1, end_line: null },
    explanation,
    remediation: "Native remediation.",
  };
}
