import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import {
  buildQualityPolicyDiff,
  type QualityPolicyThresholdChange,
} from "../src/quality-policy-diff.js";
import {
  QUALITY_POLICY_CI_MATCH_IDS,
  effectiveQualityPolicyCiPolicy,
  evaluateQualityPolicyCiPolicy,
  qualityPolicyCiModeTransition,
} from "../src/quality-policy-ci-policy.js";
import type { QualityConfig } from "../src/types/configuration.js";

test("quality policy diff covers every configurable threshold in deterministic order", () => {
  const from = qualityConfig();
  const to = qualityConfig();
  to.skillTokenWarning += 100;
  to.skillTokenHigh += 100;
  to.skillTokenWarningSource = "repository_configuration";
  to.skillTokenHighSource = "repository_configuration";
  for (const budget of Object.values(to.contentTokenBudgets)) {
    budget.warning += 100;
    budget.high += 100;
    budget.warningSource = "repository_configuration";
    budget.highSource = "repository_configuration";
  }

  const first = buildQualityPolicyDiff(from, to);
  const second = buildQualityPolicyDiff(from, to);

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.changes.map((change) => [change.assetKind, change.thresholdType]),
    [
      ["skill", "warning"],
      ["skill", "high"],
      ["context", "warning"],
      ["context", "high"],
      ["reference", "warning"],
      ["reference", "high"],
      ["profile", "warning"],
      ["profile", "high"],
      ["example", "warning"],
      ["example", "high"],
    ],
  );
  assert.ok(first.changes.every((change) => change.direction === "weakening"));
  assert.equal(first.changes[0]?.from.source, "renma_default");
  assert.equal(first.changes[0]?.to.source, "repository_configuration");
});

test("quality policy preserves warning-only High-only both and mixed transitions", () => {
  const from = qualityConfig();
  const cases: Array<{
    label: string;
    mutate: (to: QualityConfig) => void;
    expected: Array<
      Pick<QualityPolicyThresholdChange, "thresholdType" | "direction">
    >;
  }> = [
    {
      label: "warning only",
      mutate: (to) => {
        to.skillTokenWarning += 1;
      },
      expected: [{ thresholdType: "warning", direction: "weakening" }],
    },
    {
      label: "High only",
      mutate: (to) => {
        to.skillTokenHigh += 1;
      },
      expected: [{ thresholdType: "high", direction: "weakening" }],
    },
    {
      label: "both weakened",
      mutate: (to) => {
        to.skillTokenWarning += 1;
        to.skillTokenHigh += 1;
      },
      expected: [
        { thresholdType: "warning", direction: "weakening" },
        { thresholdType: "high", direction: "weakening" },
      ],
    },
    {
      label: "mixed",
      mutate: (to) => {
        to.skillTokenWarning += 1;
        to.skillTokenHigh -= 1;
      },
      expected: [
        { thresholdType: "warning", direction: "weakening" },
        { thresholdType: "high", direction: "tightening" },
      ],
    },
  ];

  for (const fixtureCase of cases) {
    const to = qualityConfig();
    fixtureCase.mutate(to);
    assert.deepEqual(
      buildQualityPolicyDiff(from, to).changes.map((change) => ({
        thresholdType: change.thresholdType,
        direction: change.direction,
      })),
      fixtureCase.expected,
      fixtureCase.label,
    );
  }
});

test("quality CI policy applies fail warn off and stricter fail-to-off resolution", () => {
  const from = qualityConfig();
  const to = qualityConfig();
  to.skillTokenWarning += 1;
  const diff = buildQualityPolicyDiff(from, to);

  assert.equal(
    evaluateQualityPolicyCiPolicy(diff, { from: "fail", to: "fail" }).outcome,
    "fail",
  );
  assert.equal(
    evaluateQualityPolicyCiPolicy(diff, { from: "warn", to: "warn" }).outcome,
    "warn",
  );
  const disabled = evaluateQualityPolicyCiPolicy(diff, {
    from: "off",
    to: "off",
  });
  assert.equal(disabled.outcome, "pass");
  assert.equal(disabled.matchCount, 1);
  assert.equal(
    effectiveQualityPolicyCiPolicy({ from: "fail", to: "off" }),
    "fail",
  );
  assert.equal(
    evaluateQualityPolicyCiPolicy(diff, { from: "fail", to: "off" }).outcome,
    "fail",
  );
  const combined = evaluateQualityPolicyCiPolicy(diff, {
    from: "fail",
    to: "off",
  });
  assert.equal(combined.matchCount, 2);
  assert.deepEqual(
    combined.matches.map((match) => match.id),
    [
      QUALITY_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED,
      QUALITY_POLICY_CI_MATCH_IDS.THRESHOLD_INCREASED,
    ],
  );
  assert.deepEqual(combined.numericThresholdChanges, {
    weakenings: 1,
    tightenings: 0,
  });
});

test("quality CI mode transitions are independently classified and governed", () => {
  const cases = [
    {
      from: "fail",
      to: "off",
      direction: "weakening",
      effective: "fail",
      outcome: "fail",
      matchCount: 1,
    },
    {
      from: "fail",
      to: "warn",
      direction: "weakening",
      effective: "fail",
      outcome: "fail",
      matchCount: 1,
    },
    {
      from: "warn",
      to: "off",
      direction: "weakening",
      effective: "warn",
      outcome: "warn",
      matchCount: 1,
    },
    {
      from: "off",
      to: "warn",
      direction: "tightening",
      effective: "warn",
      outcome: "pass",
      matchCount: 0,
    },
    {
      from: "warn",
      to: "fail",
      direction: "tightening",
      effective: "fail",
      outcome: "pass",
      matchCount: 0,
    },
    {
      from: "off",
      to: "off",
      direction: "unchanged",
      effective: "off",
      outcome: "pass",
      matchCount: 0,
    },
    {
      from: "fail",
      to: "fail",
      direction: "unchanged",
      effective: "fail",
      outcome: "pass",
      matchCount: 0,
    },
  ] as const;

  for (const fixtureCase of cases) {
    const configured = { from: fixtureCase.from, to: fixtureCase.to };
    const first = evaluateQualityPolicyCiPolicy({ changes: [] }, configured);
    const second = evaluateQualityPolicyCiPolicy({ changes: [] }, configured);

    assert.deepEqual(first, second);
    assert.deepEqual(qualityPolicyCiModeTransition(configured), {
      ...configured,
      direction: fixtureCase.direction,
    });
    assert.equal(first.configured.effective, fixtureCase.effective);
    assert.equal(first.modeTransition.direction, fixtureCase.direction);
    assert.equal(first.outcome, fixtureCase.outcome);
    assert.equal(first.matchCount, fixtureCase.matchCount);
    assert.deepEqual(first.numericThresholdChanges, {
      weakenings: 0,
      tightenings: 0,
    });
    assert.deepEqual(
      first.matches,
      fixtureCase.direction === "weakening"
        ? [
            {
              id: QUALITY_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED,
              summary: "The Quality Policy CI review mode was weakened.",
              transition: {
                ...configured,
                direction: "weakening",
              },
            },
          ]
        : [],
    );
  }
});

test("quality tightening remains visible without failing the gate", () => {
  const from = qualityConfig();
  const to = qualityConfig();
  to.contentTokenBudgets.reference.warning -= 1;
  to.contentTokenBudgets.reference.high -= 1;
  const diff = buildQualityPolicyDiff(from, to);
  const evaluation = evaluateQualityPolicyCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.equal(diff.changes.length, 2);
  assert.ok(diff.changes.every((change) => change.direction === "tightening"));
  assert.equal(evaluation.matchCount, 0);
  assert.equal(evaluation.outcome, "pass");
  assert.deepEqual(evaluation.numericThresholdChanges, {
    weakenings: 0,
    tightenings: 2,
  });
});

function qualityConfig(): QualityConfig {
  return structuredClone(DEFAULT_CONFIG.quality);
}
