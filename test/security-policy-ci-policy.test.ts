import assert from "node:assert/strict";
import test from "node:test";

import {
  SECURITY_POLICY_CI_MATCH_IDS,
  effectiveSecurityPolicyCiPolicy,
  evaluateSecurityPolicyCiPolicy,
  isSecurityPolicyRelaxation,
} from "../src/security-policy-ci-policy.js";
import { buildSecurityPolicyChanges } from "../src/security-policy-diff.js";
import type {
  DeclaredSecurityPolicyEvidence,
  SecurityPolicyAssetEvidence,
} from "../src/security-policy-inventory.js";
import type {
  ListSecurityPolicyField,
  SecurityPolicyBooleanState,
  SecurityPolicyListTransition,
  SecurityPolicyScalarTransition,
} from "../src/security-policy-diff.js";

test("obvious permission and approval weakening transitions are relaxations", () => {
  const cases: Array<
    [SecurityPolicyScalarTransition["property"], boolean, boolean]
  > = [
    ["networkAllowed", false, true],
    ["externalUploadAllowed", false, true],
    ["secretsAllowed", false, true],
    ["humanApprovalRequired", true, false],
  ];

  for (const [property, fromState, toState] of cases) {
    assert.equal(
      isSecurityPolicyRelaxation(
        transition("skill.example", property, fromState, toState),
      ),
      true,
      `${property} ${fromState} -> ${toState}`,
    );
  }
});

test("tightening transitions are not relaxations", () => {
  const cases: Array<
    [SecurityPolicyScalarTransition["property"], boolean, boolean]
  > = [
    ["networkAllowed", true, false],
    ["externalUploadAllowed", true, false],
    ["secretsAllowed", true, false],
    ["humanApprovalRequired", false, true],
  ];

  for (const [property, fromState, toState] of cases) {
    assert.equal(
      isSecurityPolicyRelaxation(
        transition("skill.example", property, fromState, toState),
      ),
      false,
      `${property} ${fromState} -> ${toState}`,
    );
  }
});

test("unspecified transitions follow effective restrictive-state semantics", () => {
  const cases: Array<
    [
      SecurityPolicyScalarTransition["property"],
      SecurityPolicyBooleanState,
      SecurityPolicyBooleanState,
      boolean,
    ]
  > = [
    ["networkAllowed", false, "unspecified", true],
    ["networkAllowed", true, "unspecified", false],
    ["networkAllowed", "unspecified", false, false],
    ["networkAllowed", "unspecified", true, false],
    ["externalUploadAllowed", false, "unspecified", true],
    ["externalUploadAllowed", true, "unspecified", false],
    ["externalUploadAllowed", "unspecified", false, false],
    ["externalUploadAllowed", "unspecified", true, false],
    ["secretsAllowed", false, "unspecified", true],
    ["secretsAllowed", true, "unspecified", false],
    ["secretsAllowed", "unspecified", false, false],
    ["secretsAllowed", "unspecified", true, false],
    ["humanApprovalRequired", true, "unspecified", true],
    ["humanApprovalRequired", false, "unspecified", false],
    ["humanApprovalRequired", "unspecified", true, false],
    ["humanApprovalRequired", "unspecified", false, false],
  ];

  for (const [property, fromState, toState, expected] of cases) {
    assert.equal(
      isSecurityPolicyRelaxation(
        transition("skill.example", property, fromState, toState),
      ),
      expected,
      `${property} ${fromState} -> ${toState}`,
    );
  }
});

test("canonical transitions retain each matched asset when aggregate counts cancel", () => {
  const fromAssets = [
    policyEvidence("skills/a/SKILL.md", false),
    policyEvidence("skills/b/SKILL.md", true),
  ];
  const toAssets = [
    policyEvidence("skills/a/SKILL.md", true),
    policyEvidence("skills/b/SKILL.md", false),
  ];
  const ids = new Map([
    ["skills/a/SKILL.md", "skill.a"],
    ["skills/b/SKILL.md", "skill.b"],
  ]);

  const diff = buildSecurityPolicyChanges({
    fromAssets,
    toAssets,
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });
  const evaluation = evaluateSecurityPolicyCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.deepEqual(
    diff.policyTransitions.map((item) =>
      item.kind === "scalar"
        ? {
            id: item.asset.id,
            from: item.fromState,
            to: item.toState,
          }
        : { id: item.asset.id, added: item.added, removed: item.removed },
    ),
    [
      { id: "skill.a", from: false, to: true },
      { id: "skill.b", from: true, to: false },
    ],
  );
  assert.equal(evaluation.outcome, "fail");
  assert.equal(evaluation.matchCount, 1);
  assert.equal(evaluation.matches[0]?.asset.id, "skill.a");
  assert.equal(
    evaluation.matches[0]?.id,
    SECURITY_POLICY_CI_MATCH_IDS.NETWORK_RELAXED,
  );
});

test("canonical transitions serialize missing effective booleans as unspecified", () => {
  const path = "skills/example/SKILL.md";
  const ids = new Map([[path, "skill.example"]]);
  const diff = buildSecurityPolicyChanges({
    fromAssets: [policyEvidence(path, false)],
    toAssets: [policyEvidence(path, null)],
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });

  assert.deepEqual(
    diff.policyTransitions.map((item) =>
      item.kind === "scalar"
        ? {
            property: item.property,
            fromState: item.fromState,
            toState: item.toState,
          }
        : {
            property: item.property,
            added: item.added,
            removed: item.removed,
          },
    ),
    [
      {
        property: "networkAllowed",
        fromState: false,
        toState: "unspecified",
      },
    ],
  );
  assert.equal(
    evaluateSecurityPolicyCiPolicy(diff, { from: "fail", to: "fail" }).outcome,
    "fail",
  );
});

test("multiple assets and properties remain independently auditable", () => {
  const evaluation = evaluateSecurityPolicyCiPolicy(
    {
      policyTransitions: [
        transition("skill.b", "secretsAllowed", false, true),
        transition("skill.a", "networkAllowed", false, true),
        transition("skill.a", "externalUploadAllowed", false, true),
        transition("skill.b", "humanApprovalRequired", true, false),
      ],
    },
    { from: "fail", to: "fail" },
  );

  assert.equal(evaluation.matchCount, 4);
  assert.deepEqual(
    evaluation.matches.map((match) => [match.id, match.asset.id]),
    [
      [SECURITY_POLICY_CI_MATCH_IDS.NETWORK_RELAXED, "skill.a"],
      [SECURITY_POLICY_CI_MATCH_IDS.EXTERNAL_UPLOAD_RELAXED, "skill.a"],
      [SECURITY_POLICY_CI_MATCH_IDS.SECRETS_RELAXED, "skill.b"],
      [SECURITY_POLICY_CI_MATCH_IDS.HUMAN_APPROVAL_REMOVED, "skill.b"],
    ],
  );
});

test("list-policy expansion and restriction removal are relaxations", () => {
  const transitions: SecurityPolicyListTransition[] = [
    listTransition("approvedNetworkDestinations", ["telemetry.vendor.io"], []),
    listTransition("approvedUploadDestinations", ["uploads.vendor.io"], []),
    listTransition("allowedData", ["customer-records"], []),
    listTransition("forbiddenInputs", [], ["credentials"]),
    listTransition("disallowedCommands", [], ["curl"]),
  ];

  for (const item of transitions) {
    assert.equal(isSecurityPolicyRelaxation(item), true, item.property);
  }

  const evaluation = evaluateSecurityPolicyCiPolicy(
    { policyTransitions: transitions },
    { from: "fail", to: "fail" },
  );
  assert.equal(evaluation.outcome, "fail");
  assert.deepEqual(
    evaluation.matches.map((match) => ({
      id: match.id,
      direction: match.direction,
      values:
        match.kind === "scalar"
          ? []
          : match.direction === "allowed_value_added"
            ? match.addedValues
            : match.removedValues,
    })),
    [
      {
        id: SECURITY_POLICY_CI_MATCH_IDS.APPROVED_NETWORK_DESTINATION_ADDED,
        direction: "allowed_value_added",
        values: ["telemetry.vendor.io"],
      },
      {
        id: SECURITY_POLICY_CI_MATCH_IDS.APPROVED_UPLOAD_DESTINATION_ADDED,
        direction: "allowed_value_added",
        values: ["uploads.vendor.io"],
      },
      {
        id: SECURITY_POLICY_CI_MATCH_IDS.ALLOWED_DATA_ADDED,
        direction: "allowed_value_added",
        values: ["customer-records"],
      },
      {
        id: SECURITY_POLICY_CI_MATCH_IDS.FORBIDDEN_INPUT_REMOVED,
        direction: "restricted_value_removed",
        values: ["credentials"],
      },
      {
        id: SECURITY_POLICY_CI_MATCH_IDS.DISALLOWED_COMMAND_REMOVED,
        direction: "restricted_value_removed",
        values: ["curl"],
      },
    ],
  );
});

test("opposite list-policy directions are tightening rather than relaxation", () => {
  const transitions: SecurityPolicyListTransition[] = [
    listTransition("approvedNetworkDestinations", [], ["api.example.com"]),
    listTransition("approvedUploadDestinations", [], ["upload.example.com"]),
    listTransition("allowedData", [], ["customer-records"]),
    listTransition("forbiddenInputs", ["credentials"], []),
    listTransition("disallowedCommands", ["curl"], []),
  ];

  for (const item of transitions) {
    assert.equal(isSecurityPolicyRelaxation(item), false, item.property);
  }
  assert.equal(
    evaluateSecurityPolicyCiPolicy(
      { policyTransitions: transitions },
      { from: "fail", to: "fail" },
    ).matchCount,
    0,
  );
});

test("effective list-policy changes become canonical per-asset CI evidence", () => {
  const path = "skills/example/SKILL.md";
  const ids = new Map([[path, "skill.example"]]);
  const diff = buildSecurityPolicyChanges({
    fromAssets: [
      listPolicyEvidence(path, {
        approvedNetworkDestinations: ["github.com"],
        approvedUploadDestinations: ["github.com"],
        allowedData: ["public"],
        forbiddenInputs: ["credentials"],
        disallowedCommands: ["curl"],
      }),
    ],
    toAssets: [
      listPolicyEvidence(path, {
        approvedNetworkDestinations: ["github.com", "telemetry.vendor.io"],
        approvedUploadDestinations: ["github.com", "uploads.vendor.io"],
        allowedData: ["public", "customer-records"],
        forbiddenInputs: [],
        disallowedCommands: [],
      }),
    ],
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });
  const evaluation = evaluateSecurityPolicyCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.deepEqual(
    diff.policyTransitions.map((item) => item.property),
    [
      "approvedNetworkDestinations",
      "approvedUploadDestinations",
      "allowedData",
      "forbiddenInputs",
      "disallowedCommands",
    ],
  );
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      SECURITY_POLICY_CI_MATCH_IDS.APPROVED_NETWORK_DESTINATION_ADDED,
      SECURITY_POLICY_CI_MATCH_IDS.APPROVED_UPLOAD_DESTINATION_ADDED,
      SECURITY_POLICY_CI_MATCH_IDS.ALLOWED_DATA_ADDED,
      SECURITY_POLICY_CI_MATCH_IDS.FORBIDDEN_INPUT_REMOVED,
      SECURITY_POLICY_CI_MATCH_IDS.DISALLOWED_COMMAND_REMOVED,
    ],
  );
  assert.ok(
    evaluation.matches.every(
      (match) =>
        match.asset.id === "skill.example" &&
        match.provenance.mode === "direct",
    ),
  );
});

test("CI modes control outcome and stricter-side resolution prevents bypass", () => {
  const security = {
    policyTransitions: [
      transition("skill.example", "networkAllowed", false, true),
    ],
  };

  assert.equal(
    evaluateSecurityPolicyCiPolicy(security, { from: "fail", to: "fail" })
      .outcome,
    "fail",
  );
  assert.equal(
    evaluateSecurityPolicyCiPolicy(security, { from: "warn", to: "warn" })
      .outcome,
    "warn",
  );
  const disabled = evaluateSecurityPolicyCiPolicy(security, {
    from: "off",
    to: "off",
  });
  assert.equal(disabled.outcome, "pass");
  assert.equal(disabled.matchCount, 1);
  assert.deepEqual(disabled.configured, {
    from: "off",
    to: "off",
    effective: "off",
  });
  assert.equal(
    effectiveSecurityPolicyCiPolicy({ from: "fail", to: "off" }),
    "fail",
  );
  assert.equal(
    evaluateSecurityPolicyCiPolicy(security, { from: "fail", to: "off" })
      .outcome,
    "fail",
  );
  assert.equal(
    effectiveSecurityPolicyCiPolicy({ from: "off", to: "warn" }),
    "warn",
  );
});

test("new and deleted assets do not produce policy transitions", () => {
  const added = buildSecurityPolicyChanges({
    fromAssets: [],
    toAssets: [policyEvidence("skills/new/SKILL.md", true)],
  });
  const removed = buildSecurityPolicyChanges({
    fromAssets: [policyEvidence("skills/old/SKILL.md", true)],
    toAssets: [],
  });

  assert.deepEqual(added.policyTransitions, []);
  assert.deepEqual(removed.policyTransitions, []);
});

function transition(
  assetId: string,
  property: SecurityPolicyScalarTransition["property"],
  fromState: SecurityPolicyBooleanState,
  toState: SecurityPolicyBooleanState,
): SecurityPolicyScalarTransition {
  const path = `skills/${assetId.split(".").at(-1)}/SKILL.md`;
  return {
    kind: "scalar",
    asset: { id: assetId, path, kind: "skill" },
    property,
    fromState,
    toState,
    provenance: {
      mode: "direct",
      sources: [{ type: "asset", id: assetId, path }],
    },
  };
}

function listTransition(
  property: ListSecurityPolicyField,
  added: string[],
  removed: string[],
): SecurityPolicyListTransition {
  const path = "skills/example/SKILL.md";
  return {
    kind: "list",
    asset: { id: "skill.example", path, kind: "skill" },
    property,
    added,
    removed,
    provenance: {
      mode: "direct",
      sources: [{ type: "asset", id: "skill.example", path }],
    },
  };
}

function policyEvidence(
  path: string,
  networkAllowed: boolean | null,
): SecurityPolicyAssetEvidence {
  const declaredPolicy: DeclaredSecurityPolicyEvidence = {
    fields: networkAllowed === null ? [] : ["networkAllowed"],
    invalidDeclared: [],
    allowedData: [],
    forbiddenInputs: [],
    networkAllowed,
    externalUploadAllowed: null,
    secretsAllowed: null,
    humanApprovalRequired: null,
    approvedNetworkDestinations: [],
    approvedUploadDestinations: [],
    disallowedCommands: [],
  };
  return {
    path,
    kind: "skill",
    hasLocalPolicyMetadata: networkAllowed !== null,
    hasEffectivePolicy: networkAllowed !== null,
    policySources: networkAllowed === null ? [] : ["local"],
    profileResolution: "none",
    profileChain: [],
    declaredPolicy,
    effectivePolicy: {
      fingerprint: "sha256:test",
      allowedData: [],
      forbiddenInputs: [],
      networkAllowed,
      externalUploadAllowed: null,
      secretsAllowed: null,
      humanApprovalRequired: null,
      approvedNetworkDestinations: [],
      approvedUploadDestinations: [],
      disallowedCommands: [],
    },
    evidence: { policyFields: [] },
  };
}

function listPolicyEvidence(
  path: string,
  values: {
    approvedNetworkDestinations: string[];
    approvedUploadDestinations: string[];
    allowedData: string[];
    forbiddenInputs: string[];
    disallowedCommands: string[];
  },
): SecurityPolicyAssetEvidence {
  const evidence = policyEvidence(path, null);
  const fields: ListSecurityPolicyField[] = [
    "approvedNetworkDestinations",
    "approvedUploadDestinations",
    "allowedData",
    "forbiddenInputs",
    "disallowedCommands",
  ];
  return {
    ...evidence,
    hasLocalPolicyMetadata: true,
    hasEffectivePolicy: true,
    policySources: ["local"],
    declaredPolicy: {
      ...evidence.declaredPolicy!,
      fields,
      ...values,
    },
    effectivePolicy: {
      ...evidence.effectivePolicy,
      ...values,
    },
  };
}
