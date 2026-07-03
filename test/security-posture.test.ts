import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeSecurityPosture,
  zeroSecurityPostureSummary,
} from "../src/security-posture.js";

test("empty security posture summary returns zero counts", () => {
  assert.deepEqual(summarizeSecurityPosture([]), zeroSecurityPostureSummary());
});

test("security posture counts mixed SEC findings by risk class", () => {
  const summary = summarizeSecurityPosture([
    finding("SEC-MISSING-POLICY-METADATA", "medium", "advisory"),
    finding("SEC-UNAPPROVED-NETWORK-DESTINATION", "high", "violation"),
    finding("SEC-EXTERNAL-UPLOAD-INSTRUCTION", "medium", "suspicious"),
  ]);

  assert.equal(summary.totalSecurityFindings, 3);
  assert.deepEqual(summary.riskClasses, {
    violation: 1,
    suspicious: 1,
    advisory: 1,
    unclassified: 0,
  });
  assert.deepEqual(summary.severities, {
    critical: 0,
    high: 1,
    medium: 2,
    low: 0,
  });
});

test("SEC finding without risk class increments unclassified", () => {
  const summary = summarizeSecurityPosture([
    finding("SEC-LEGACY-FINDING", "low"),
  ]);

  assert.equal(summary.totalSecurityFindings, 1);
  assert.equal(summary.riskClasses.unclassified, 1);
});

test("non-SEC finding without risk class is ignored", () => {
  const summary = summarizeSecurityPosture([
    finding("QUAL-MISSING-EXAMPLES", "high"),
  ]);

  assert.deepEqual(summary, zeroSecurityPostureSummary());
});

test("non-SEC finding with risk class is counted as security-related", () => {
  const summary = summarizeSecurityPosture([
    finding("CUSTOM-POLICY", "medium", "suspicious"),
  ]);

  assert.equal(summary.totalSecurityFindings, 1);
  assert.equal(summary.riskClasses.suspicious, 1);
  assert.equal(summary.severities.medium, 1);
});

test("highOrCritical counts only high and critical security findings", () => {
  const summary = summarizeSecurityPosture([
    finding("SEC-LOW", "low", "advisory"),
    finding("SEC-MEDIUM", "medium", "suspicious"),
    finding("SEC-HIGH", "high", "violation"),
    finding("SEC-CRITICAL", "critical", "violation"),
    finding("MAINT-HIGH", "high"),
  ]);

  assert.equal(summary.highOrCritical, 2);
});

test("topFindingIds is deterministic and uses max severity", () => {
  const summary = summarizeSecurityPosture([
    finding("SEC-B", "medium", "suspicious"),
    finding("SEC-C", "high", "advisory"),
    finding("SEC-A", "medium", "violation"),
    finding("SEC-B", "critical", "suspicious"),
    finding("SEC-A", "medium", "violation"),
    finding("SEC-D", "high", "advisory"),
  ]);

  assert.deepEqual(summary.topFindingIds, [
    {
      id: "SEC-B",
      count: 2,
      riskClass: "suspicious",
      maxSeverity: "critical",
    },
    {
      id: "SEC-A",
      count: 2,
      riskClass: "violation",
      maxSeverity: "medium",
    },
    {
      id: "SEC-C",
      count: 1,
      riskClass: "advisory",
      maxSeverity: "high",
    },
    {
      id: "SEC-D",
      count: 1,
      riskClass: "advisory",
      maxSeverity: "high",
    },
  ]);
});

function finding(id: string, severity: string, riskClass?: string) {
  return {
    id,
    severity,
    ...(riskClass ? { riskClass } : {}),
  };
}
