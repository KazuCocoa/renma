import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDiagnosticSeverityCiPolicy } from "../src/diagnostic-severity-ci-policy.js";
import { evaluateExecutableSurfaceCiPolicy } from "../src/executable-surface-ci-policy.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import { zeroExecutableSurfaceInventory } from "../src/executable-surface-inventory.js";
import { evaluateMetadataPolicyCiPolicy } from "../src/metadata-policy-ci-policy.js";
import { evaluateQualityPolicyCiPolicy } from "../src/quality-policy-ci-policy.js";
import { evaluateScanBoundaryCiPolicy } from "../src/scan-boundary-ci-policy.js";
import { evaluateSecurityPolicyCiPolicy } from "../src/security-policy-ci-policy.js";

// These expectations are independent of the shared mode implementation. A
// mode-only change is evidence for some policies, but not for every evaluator.
const TRANSITIONS = [
  ["off", "off", "off", "pass", 0],
  ["off", "warn", "warn", "pass", 0],
  ["off", "fail", "fail", "pass", 0],
  ["warn", "off", "warn", "warn", 1],
  ["warn", "warn", "warn", "pass", 0],
  ["warn", "fail", "fail", "pass", 0],
  ["fail", "off", "fail", "fail", 1],
  ["fail", "warn", "fail", "fail", 1],
  ["fail", "fail", "fail", "pass", 0],
] as const;

type Configuration = {
  from: "off" | "warn" | "fail";
  to: "off" | "warn" | "fail";
};

const emptyExecutableDiff = buildExecutableSurfaceDiff(
  zeroExecutableSurfaceInventory(),
  zeroExecutableSurfaceInventory(),
);

const POLICIES = [
  {
    name: "metadata",
    modeMatchId: "metadata_policy_ci.ci_policy_relaxed",
    evaluate: (configured: Configuration) =>
      evaluateMetadataPolicyCiPolicy({ changes: [] }, configured),
  },
  {
    name: "quality",
    modeMatchId: "quality_policy_ci.ci_policy_relaxed",
    evaluate: (configured: Configuration) =>
      evaluateQualityPolicyCiPolicy({ changes: [] }, configured),
  },
  {
    name: "diagnostic severity",
    modeMatchId: "diagnostic_severity_ci.ci_policy_relaxed",
    evaluate: (configured: Configuration) =>
      evaluateDiagnosticSeverityCiPolicy({ changes: [] }, configured),
  },
  {
    name: "scan boundary",
    modeMatchId: null,
    evaluate: (configured: Configuration) =>
      evaluateScanBoundaryCiPolicy({ changes: [] }, configured),
  },
  {
    name: "executable surface",
    modeMatchId: null,
    evaluate: (configured: Configuration) =>
      evaluateExecutableSurfaceCiPolicy(emptyExecutableDiff, configured),
  },
  {
    name: "security",
    modeMatchId: null,
    evaluate: (configured: Configuration) =>
      evaluateSecurityPolicyCiPolicy({ policyTransitions: [] }, configured),
  },
];

for (const policy of POLICIES) {
  test(`${policy.name} preserves its own mode-only review contract`, async (t) => {
    for (const [
      from,
      to,
      effective,
      modeOutcome,
      modeMatchCount,
    ] of TRANSITIONS) {
      await t.test(`${from} -> ${to}`, () => {
        const result = policy.evaluate({ from, to });
        assert.deepEqual(result.configured, { from, to, effective });
        assert.equal(result.outcome, policy.modeMatchId ? modeOutcome : "pass");
        assert.equal(
          result.matchCount,
          policy.modeMatchId ? modeMatchCount : 0,
        );
        assert.deepEqual(
          result.matches.map((match) => match.id),
          policy.modeMatchId && modeMatchCount ? [policy.modeMatchId] : [],
        );
      });
    }
  });
}
