import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { ciReport, formatCiReport } from "../src/commands/ci-report.js";
import { runScanCommand } from "../src/commands/scan.js";
import {
  CONFIGURABLE_DIAGNOSTIC_FINDING_IDS,
  DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS,
  diagnosticDefaultSeverity,
  diagnosticFindingSeverityDefinition,
  verifiedDiagnosticFindingSeverity,
} from "../src/diagnostic-default-severity.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  buildDiagnosticSeverityPolicyDiff,
  type DiagnosticSeverityPolicyDiff,
} from "../src/diagnostic-severity-policy-diff.js";
import {
  DIAGNOSTIC_SEVERITY_CI_MATCH_IDS,
  evaluateDiagnosticSeverityCiPolicy,
} from "../src/diagnostic-severity-ci-policy.js";
import { formatJson, formatText } from "../src/report.js";
import { scan } from "../src/scanner.js";
import { SECURITY_RULE_FINDING_DIAGNOSTIC_IDS } from "../src/security-diagnostics.js";
import type {
  DiagnosticsCiPolicyMode,
  DiagnosticsConfig,
} from "../src/types/configuration.js";
import { RepositoryFixture } from "./repository-fixture.js";

const LOW_ID = DIAGNOSTIC_IDS.QUAL_MISSING_EXAMPLES;
const MEDIUM_ID = DIAGNOSTIC_IDS.QUAL_MISSING_DESCRIPTION;
const HIGH_ID = DIAGNOSTIC_IDS.SUPPORT_MISSING_PATH;

test("diagnostic defaults resolve statically without repository findings", () => {
  assert.equal(diagnosticDefaultSeverity(LOW_ID), "low");
  assert.equal(diagnosticDefaultSeverity(MEDIUM_ID), "medium");
  assert.equal(diagnosticDefaultSeverity(HIGH_ID), "high");
  assert.equal(
    diagnosticDefaultSeverity(DIAGNOSTIC_IDS.QUAL_SKILL_TOKEN_BUDGET),
    undefined,
  );
  assert.deepEqual(
    diagnosticFindingSeverityDefinition(DIAGNOSTIC_IDS.QUAL_SKILL_TOKEN_BUDGET),
    { configurable: true, defaultSeverity: "variable" },
  );
});

test("every configurable Finding severity definition uses a stable diagnostic ID", () => {
  const stableIds = new Set<string>(Object.values(DIAGNOSTIC_IDS));
  assert.deepEqual(
    CONFIGURABLE_DIAGNOSTIC_FINDING_IDS,
    Object.keys(DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS).sort(),
  );
  for (const diagnosticId of CONFIGURABLE_DIAGNOSTIC_FINDING_IDS) {
    assert.ok(stableIds.has(diagnosticId), diagnosticId);
  }
});

test("the security Finding registry is covered by the configurable severity authority", () => {
  for (const diagnosticId of SECURITY_RULE_FINDING_DIAGNOSTIC_IDS) {
    assert.ok(
      DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS[diagnosticId],
      diagnosticId,
    );
  }
});

test("fixed Finding producers cannot drift from the severity authority", () => {
  assert.throws(
    () => verifiedDiagnosticFindingSeverity(HIGH_ID, "medium"),
    /emitted "medium" but its registered built-in severity is "high"/,
  );
});

test("diagnostic severity policy elevates a built-in low finding for output and fail_on", async (t) => {
  const fixture = await missingExamplesFixture(t);
  await fixture.writeConfig({ fail_on: "critical" });

  const baseline = await scan(fixture.root);
  const baselineFinding = baseline.findings.find(
    (finding) => finding.id === LOW_ID,
  );
  const baselineDiagnostic = baseline.diagnostics.find(
    (diagnostic) => diagnostic.code === LOW_ID,
  );
  assert.equal(baselineFinding?.severity, "low");
  assert.equal(baselineDiagnostic?.severity, "warning");
  assert.equal(baselineFinding?.details?.defaultSeverity, undefined);
  assert.equal(
    (await captureStdout(() => runScanCommand(fixture.root, {}, {}))).code,
    0,
  );

  await fixture.writeConfig({
    fail_on: "critical",
    diagnostics: { severity: { [LOW_ID]: "critical" } },
  });
  const result = await scan(fixture.root);
  const finding = result.findings.find((candidate) => candidate.id === LOW_ID);
  const diagnostic = result.diagnostics.find(
    (candidate) => candidate.code === LOW_ID,
  );

  assert.equal(finding?.severity, "critical");
  assert.equal(finding?.details?.defaultSeverity, "low");
  assert.equal(finding?.details?.severitySource, "repository_configuration");
  assert.equal(diagnostic?.severity, "error");
  assert.equal(diagnostic?.details?.findingSeverity, "critical");
  assert.equal(diagnostic?.details?.defaultSeverity, "low");
  assert.match(formatText(result), new RegExp(`CRITICAL ${LOW_ID}`));
  assert.match(formatJson(result), /"defaultSeverity": "low"/);

  const command = await captureStdout(() =>
    runScanCommand(fixture.root, {}, {}),
  );
  assert.equal(command.code, 1);
});

test("diagnostic severity policy lowers a built-in high finding for output and fail_on", async (t) => {
  const fixture = await missingSupportPathFixture(t);
  await fixture.writeConfig({ fail_on: "high" });

  const baseline = await scan(fixture.root);
  const baselineFinding = baseline.findings.find(
    (finding) => finding.id === HIGH_ID,
  );
  assert.equal(baselineFinding?.severity, "high");
  assert.equal(
    (await captureStdout(() => runScanCommand(fixture.root, {}, {}))).code,
    1,
  );

  await fixture.writeConfig({
    fail_on: "high",
    diagnostics: { severity: { [HIGH_ID]: "low" } },
  });
  const result = await scan(fixture.root);
  const finding = result.findings.find((candidate) => candidate.id === HIGH_ID);
  const diagnostic = result.diagnostics.find(
    (candidate) => candidate.code === HIGH_ID,
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.details?.defaultSeverity, "high");
  assert.equal(finding?.details?.severitySource, "repository_configuration");
  assert.equal(diagnostic?.severity, "warning");
  assert.equal(diagnostic?.details?.findingSeverity, "low");
  assert.equal(diagnostic?.details?.defaultSeverity, "high");
  assert.match(formatText(result), new RegExp(`LOW ${HIGH_ID}`));
  assert.match(formatJson(result), /"findingSeverity": "low"/);
  assert.match(formatJson(result), /"defaultSeverity": "high"/);
  assert.equal(
    (await captureStdout(() => runScanCommand(fixture.root, {}, {}))).code,
    0,
  );
});

test("diagnostic severity policy parses equivalently from JSON and JSONC", async (t) => {
  for (const [extension, source] of [
    [
      "json",
      JSON.stringify({
        diagnostics: {
          ci_policy: "warn",
          severity: { [LOW_ID]: "critical" },
        },
      }),
    ],
    [
      "jsonc",
      `{ // Repository risk policy.\n  "diagnostics": { "ci_policy": "warn", "severity": { "${LOW_ID}": "critical" } }\n}`,
    ],
  ] as const) {
    await t.test(extension, async (caseContext) => {
      const fixture = await RepositoryFixture.create({
        testContext: caseContext,
      });
      await fixture.write(`renma.config.${extension}`, source);
      const loaded = await loadConfig(fixture.root, {});
      assert.deepEqual(
        { ...loaded.config.diagnostics.severity },
        {
          [LOW_ID]: "critical",
        },
      );
      assert.equal(loaded.config.diagnostics.ciPolicy, "warn");
    });
  }
});

test("diagnostic severity policy validates its closed configuration", async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    [
      "invalid severity",
      { diagnostics: { severity: { [LOW_ID]: "very-high" } } },
      /diagnostics\.severity\.QUAL-MISSING-EXAMPLES must be one of: low, medium, high, critical/,
    ],
    [
      "unknown diagnostic id",
      { diagnostics: { severity: { "META-TYPO-DOES-NOT-EXIST": "high" } } },
      /unknown diagnostic id "META-TYPO-DOES-NOT-EXIST"/,
    ],
    [
      "known non-Finding diagnostic id",
      {
        diagnostics: {
          severity: {
            [DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT]: "high",
          },
        },
      },
      /diagnostics\.severity does not support "DISCOVERY-INVALID-PUBLISHED-ENTRYPOINT" because it is not a configurable scan Finding/,
    ],
    [
      "unknown diagnostics key",
      { diagnostics: { unknown_key: true } },
      /diagnostics:\n- "unknown_key" \(unknown\)/,
    ],
  ];
  for (const [name, config, expected] of cases) {
    await t.test(name, async (caseContext) => {
      const fixture = await RepositoryFixture.create({
        testContext: caseContext,
      });
      await fixture.writeConfig(config);
      await assert.rejects(
        loadConfig(fixture.root, {}),
        (error: unknown) =>
          error instanceof ConfigError && expected.test(error.message),
      );
    });
  }
});

test("diagnostic severity defaults are request-local and preserve existing behavior", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  const first = await loadConfig(fixture.root, {});
  assert.deepEqual(first.config.diagnostics, {
    ciPolicy: "fail",
    severity: {},
  });
  first.config.diagnostics.severity[LOW_ID] = "critical";
  const second = await loadConfig(fixture.root, {});
  assert.deepEqual(second.config.diagnostics, {
    ciPolicy: "fail",
    severity: {},
  });
});

test("suppression remains a scoped exception after severity override", async (t) => {
  const fixture = await missingSupportPathFixture(t);
  await fixture.writeConfig({
    fail_on: "critical",
    diagnostics: { severity: { [HIGH_ID]: "critical" } },
    suppressions: [
      {
        id: HIGH_ID,
        paths: ["skills/demo/**"],
        reason: "Temporary migration exception",
        expires: "2026-12-31",
      },
    ],
  });

  const result = await scan(fixture.root);
  assert.equal(
    result.findings.some((finding) => finding.id === HIGH_ID),
    false,
  );
  const suppressed = result.suppressedFindings.find(
    (item) => item.finding.id === HIGH_ID,
  );
  assert.equal(suppressed?.finding.severity, "critical");
  assert.equal(suppressed?.finding.details?.defaultSeverity, "high");
  assert.equal(suppressed?.suppression.reason, "Temporary migration exception");
});

test("diagnostic severity policy diff compares effective severities for add and removal", () => {
  const cases = [
    {
      name: "default high to override low",
      diagnosticId: HIGH_ID,
      from: {},
      to: { [HIGH_ID]: "low" },
      change: "added",
      direction: "weakening",
      fromSeverity: "high",
      toSeverity: "low",
    },
    {
      name: "override low to default high",
      diagnosticId: HIGH_ID,
      from: { [HIGH_ID]: "low" },
      to: {},
      change: "removed",
      direction: "tightening",
      fromSeverity: "low",
      toSeverity: "high",
    },
    {
      name: "default medium to override high",
      diagnosticId: MEDIUM_ID,
      from: {},
      to: { [MEDIUM_ID]: "high" },
      change: "added",
      direction: "tightening",
      fromSeverity: "medium",
      toSeverity: "high",
    },
    {
      name: "override high to default medium",
      diagnosticId: MEDIUM_ID,
      from: { [MEDIUM_ID]: "high" },
      to: {},
      change: "removed",
      direction: "weakening",
      fromSeverity: "high",
      toSeverity: "medium",
    },
    {
      name: "default high to explicit high",
      diagnosticId: HIGH_ID,
      from: {},
      to: { [HIGH_ID]: "high" },
      change: "added",
      direction: "neutral",
      fromSeverity: "high",
      toSeverity: "high",
    },
    {
      name: "explicit high to default high",
      diagnosticId: HIGH_ID,
      from: { [HIGH_ID]: "high" },
      to: {},
      change: "removed",
      direction: "neutral",
      fromSeverity: "high",
      toSeverity: "high",
    },
  ] as const;

  for (const item of cases) {
    const diff = buildDiagnosticSeverityPolicyDiff(
      policy("fail", item.from),
      policy("fail", item.to),
      "base/renma.config.json",
      "target/renma.config.json",
    );
    assertPolicyChange(
      diff,
      item.diagnosticId,
      item.change,
      item.direction,
      item.fromSeverity,
      item.toSeverity,
      item.name,
    );
    if (item.direction === "neutral") {
      assert.deepEqual(diff.neutralDiagnosticIds, [item.diagnosticId]);
      const evaluation = evaluateDiagnosticSeverityCiPolicy(diff, {
        from: "fail",
        to: "fail",
      });
      assert.equal(evaluation.outcome, "pass", item.name);
      assert.equal(evaluation.matchCount, 0, item.name);
      assert.equal(evaluation.severityChanges.neutrals, 1, item.name);
    }
  }
});

test("diagnostic severity policy diff requires review for a variable built-in severity", () => {
  const variableId = DIAGNOSTIC_IDS.QUAL_SKILL_TOKEN_BUDGET;
  const diff = buildDiagnosticSeverityPolicyDiff(
    policy("fail", {}),
    policy("fail", { [variableId]: "low" }),
  );
  assertPolicyChange(diff, variableId, "added", "review_required", null, "low");
  assert.deepEqual(diff.reviewRequiredDiagnosticIds, [variableId]);
  const evaluation = evaluateDiagnosticSeverityCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });
  assert.equal(evaluation.outcome, "fail");
  assert.equal(evaluation.severityChanges.reviewRequired, 1);
  assert.equal(
    evaluation.matches[0]?.id,
    DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.SEVERITY_POLICY_REVIEW_REQUIRED,
  );
});

test("diagnostics CI policy uses the stricter endpoint for mode weakening", () => {
  const diff = buildDiagnosticSeverityPolicyDiff(
    policy("fail", { [HIGH_ID]: "critical" }),
    policy("off", { [HIGH_ID]: "high" }),
  );
  const evaluation = evaluateDiagnosticSeverityCiPolicy(diff, {
    from: "fail",
    to: "off",
  });

  assert.equal(evaluation.configured.effective, "fail");
  assert.equal(evaluation.modeTransition.direction, "weakening");
  assert.equal(evaluation.outcome, "fail");
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.CI_POLICY_RELAXED,
      DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.SEVERITY_POLICY_WEAKENED,
    ],
  );
});

test("ci-report detects severity weakening when the finding is absent from both snapshots", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("healthy", { owner: "qa-platform", status: "stable" });
  await fixture.initializeGit();
  await fixture.writeConfig({ diagnostics: { ci_policy: "fail" } });
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base without severity override"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    diagnostics: { ci_policy: "fail", severity: { [HIGH_ID]: "low" } },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "lower absent diagnostic"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  const change = report.diff.diagnosticSeverityPolicy?.changes[0];
  assert.equal(report.status, "fail");
  assert.equal(report.diagnosticSeverityPolicy?.severityChanges.weakenings, 1);
  assert.equal(change?.diagnosticId, HIGH_ID);
  assert.equal(change?.direction, "weakening");
  assert.equal(change?.from.severity, "high");
  assert.equal(change?.to.severity, "low");
  assert.equal(
    report.diff.findings.added.some((finding) => finding.id === HIGH_ID),
    false,
  );
  assert.equal(
    report.diff.findings.removed.some((finding) => finding.id === HIGH_ID),
    false,
  );
});

test("ci-report rejects same-change severity and diagnostics guard weakening", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("healthy", { owner: "qa-platform", status: "stable" });
  await fixture.initializeGit();
  await fixture.writeConfig({
    diagnostics: {
      ci_policy: "fail",
      severity: { [HIGH_ID]: "critical" },
    },
  });
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "strict diagnostic severity"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    diagnostics: { ci_policy: "off", severity: { [HIGH_ID]: "high" } },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "weaken diagnostic severity"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  assert.equal(report.status, "fail");
  assert.equal(report.diagnosticSeverityPolicy?.configured.effective, "fail");
  assert.equal(report.diagnosticSeverityPolicy?.severityChanges.weakenings, 1);
  assert.equal(report.diagnosticSeverityPolicy?.matchCount, 2);
  assert.equal(
    report.diff.diagnosticSeverityPolicy?.changes[0]?.direction,
    "weakening",
  );
  assert.match(
    formatCiReport(report, "markdown"),
    /Diagnostic Severity Policy/,
  );
  assert.match(
    formatCiReport(report, "markdown"),
    /stricter fail endpoint mode governs this comparison/,
  );
});

async function missingExamplesFixture(
  testContext: test.TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({ testContext });
  await fixture.skill("demo", {
    owner: "qa-platform",
    status: "stable",
  });
  return fixture;
}

async function missingSupportPathFixture(
  testContext: test.TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({ testContext });
  await fixture.skill("demo", {
    owner: "qa-platform",
    status: "stable",
    body: [
      "# demo",
      "",
      "Read references/missing.md before reporting completion.",
    ].join("\n"),
  });
  return fixture;
}

function policy(
  ciPolicy: DiagnosticsCiPolicyMode,
  severity: DiagnosticsConfig["severity"],
): DiagnosticsConfig {
  return { ciPolicy, severity };
}

function assertPolicyChange(
  diff: DiagnosticSeverityPolicyDiff,
  diagnosticId: string,
  change: "added" | "removed" | "changed",
  direction: "weakening" | "tightening" | "neutral" | "review_required",
  fromSeverity: string | null,
  toSeverity: string,
  message?: string,
): void {
  const assertionMessage = message ?? diagnosticId;
  assert.equal(diff.changes.length, 1, assertionMessage);
  assert.equal(diff.changes[0]?.diagnosticId, diagnosticId, assertionMessage);
  assert.equal(diff.changes[0]?.change, change, assertionMessage);
  assert.equal(diff.changes[0]?.direction, direction, assertionMessage);
  assert.equal(diff.changes[0]?.from.severity, fromSeverity, assertionMessage);
  assert.equal(diff.changes[0]?.to.severity, toSeverity, assertionMessage);
}

async function captureStdout(
  action: () => Promise<number>,
): Promise<{ code: number; stdout: string }> {
  const originalWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await action(), stdout };
  } finally {
    process.stdout.write = originalWrite;
  }
}
