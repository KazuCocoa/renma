import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { ciReport, formatCiReport } from "../src/commands/ci-report.js";
import { runScanCommand } from "../src/commands/scan.js";
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
import type {
  DiagnosticsCiPolicyMode,
  DiagnosticsConfig,
} from "../src/types/configuration.js";
import { RepositoryFixture } from "./repository-fixture.js";

const ID = DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY;

test("diagnostic severity policy elevates a finding centrally and gates fail_on", async (t) => {
  const fixture = await suspendedDependencyFixture(t);
  const sourceBefore = await fixture.read("skills/source/SKILL.md");
  const targetBefore = await fixture.read("contexts/suspended.md");

  const baseline = await scan(fixture.root);
  const baselineFinding = baseline.findings.find(
    (finding) => finding.id === ID,
  );
  assert.equal(baselineFinding?.severity, "medium");
  assert.equal(baselineFinding?.details?.defaultSeverity, undefined);

  await fixture.writeConfig({
    fail_on: "high",
    diagnostics: { severity: { [ID]: "high" } },
  });
  const result = await scan(fixture.root);
  const finding = result.findings.find((candidate) => candidate.id === ID);
  const diagnostic = result.diagnostics.find(
    (candidate) => candidate.code === ID,
  );

  assert.equal(finding?.severity, "high");
  assert.equal(finding?.details?.defaultSeverity, "medium");
  assert.equal(finding?.details?.severitySource, "repository_configuration");
  assert.equal(diagnostic?.severity, "error");
  assert.equal(diagnostic?.details?.findingSeverity, "high");
  assert.equal(diagnostic?.details?.defaultSeverity, "medium");
  assert.match(formatText(result), new RegExp(`HIGH ${ID}`));
  assert.match(formatJson(result), /"defaultSeverity": "medium"/);

  const command = await captureStdout(() =>
    runScanCommand(fixture.root, {}, {}),
  );
  assert.equal(command.code, 1);
  assert.equal(await fixture.read("skills/source/SKILL.md"), sourceBefore);
  assert.equal(await fixture.read("contexts/suspended.md"), targetBefore);
});

test("diagnostic severity policy parses equivalently from JSON and JSONC", async (t) => {
  for (const [extension, source] of [
    [
      "json",
      JSON.stringify({
        diagnostics: { ci_policy: "warn", severity: { [ID]: "critical" } },
      }),
    ],
    [
      "jsonc",
      `{ // Repository risk policy.\n  "diagnostics": { "ci_policy": "warn", "severity": { "${ID}": "critical" } }\n}`,
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
          [ID]: "critical",
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
      { diagnostics: { severity: { [ID]: "very-high" } } },
      /diagnostics\.severity\.META-REQUIRED-SUSPENDED-DEPENDENCY must be one of: low, medium, high, critical/,
    ],
    [
      "unknown diagnostic id",
      { diagnostics: { severity: { "META-TYPO-DOES-NOT-EXIST": "high" } } },
      /unknown diagnostic id "META-TYPO-DOES-NOT-EXIST"/,
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
  first.config.diagnostics.severity[ID] = "critical";
  const second = await loadConfig(fixture.root, {});
  assert.deepEqual(second.config.diagnostics, {
    ciPolicy: "fail",
    severity: {},
  });
});

test("suppression remains a scoped exception after severity override", async (t) => {
  const fixture = await suspendedDependencyFixture(t);
  await fixture.writeConfig({
    fail_on: "high",
    diagnostics: { severity: { [ID]: "high" } },
    suppressions: [
      {
        id: ID,
        paths: ["skills/source/**"],
        reason: "Temporary migration exception",
        expires: "2026-12-31",
      },
    ],
  });

  const result = await scan(fixture.root);
  assert.equal(
    result.findings.some((finding) => finding.id === ID),
    false,
  );
  const suppressed = result.suppressedFindings.find(
    (item) => item.finding.id === ID,
  );
  assert.equal(suppressed?.finding.severity, "high");
  assert.equal(suppressed?.finding.details?.defaultSeverity, "medium");
  assert.equal(suppressed?.suppression.reason, "Temporary migration exception");
});

test("diagnostic severity policy diff classifies strengthening, weakening, and removal", () => {
  const strengthening = buildDiagnosticSeverityPolicyDiff(
    policy("fail", {}),
    policy("fail", { [ID]: "high" }),
    undefined,
    "renma.config.json",
    { to: { [ID]: "medium" } },
  );
  assertPolicyChange(strengthening, "added", "tightening", "medium", "high");

  const weakening = buildDiagnosticSeverityPolicyDiff(
    policy("fail", { [ID]: "critical" }),
    policy("fail", { [ID]: "high" }),
  );
  assertPolicyChange(weakening, "changed", "weakening", "critical", "high");

  const removal = buildDiagnosticSeverityPolicyDiff(
    policy("fail", { [ID]: "high" }),
    policy("fail", {}),
    "base/renma.config.json",
    "target/renma.config.json",
    { to: { [ID]: "medium" } },
  );
  assertPolicyChange(removal, "removed", "weakening", "high", "medium");
  assert.deepEqual(removal.weakenedDiagnosticIds, [ID]);
});

test("diagnostics CI policy uses the stricter endpoint for mode weakening", () => {
  const diff = buildDiagnosticSeverityPolicyDiff(
    policy("fail", { [ID]: "critical" }),
    policy("off", { [ID]: "high" }),
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

test("ci-report rejects same-change severity and diagnostics guard weakening", async (t) => {
  const fixture = await suspendedDependencyFixture(t);
  await fixture.initializeGit();
  await fixture.writeConfig({
    diagnostics: { ci_policy: "fail", severity: { [ID]: "critical" } },
  });
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "strict diagnostic severity"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    diagnostics: { ci_policy: "off", severity: { [ID]: "high" } },
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

async function suspendedDependencyFixture(
  testContext: test.TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({ testContext });
  await fixture.skill("source", {
    id: "skill.source",
    owner: "qa-platform",
    status: "stable",
    metadata: {
      "requires-context": JSON.stringify(["context.suspended"]),
    },
  });
  await fixture.context("contexts/suspended.md", {
    id: "context.suspended",
    owner: "qa-platform",
    status: "suspended",
    statusReason: "Temporarily disabled pending review.",
    statusChangedAt: "2026-08-03",
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
  change: "added" | "removed" | "changed",
  direction: "weakening" | "tightening",
  fromSeverity: string,
  toSeverity: string,
): void {
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0]?.diagnosticId, ID);
  assert.equal(diff.changes[0]?.change, change);
  assert.equal(diff.changes[0]?.direction, direction);
  assert.equal(diff.changes[0]?.from.severity, fromSeverity);
  assert.equal(diff.changes[0]?.to.severity, toSeverity);
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
