import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSecurityPolicyAssetEvidence,
  summarizeSecurityPolicyAssetEvidence,
  summarizeSecurityPolicyInventory,
  zeroSecurityPolicyInventorySummary,
} from "../src/security-policy-inventory.js";
import { parseSecurityPolicy } from "../src/security-policy.js";
import type { Artifact, ArtifactKind, SecurityConfig } from "../src/types.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

test("empty policy inventory returns a zero summary", () => {
  assert.deepEqual(
    summarizeSecurityPolicyInventory([]),
    zeroSecurityPolicyInventorySummary(),
  );
  assert.deepEqual(
    summarizeSecurityPolicyAssetEvidence([]),
    zeroSecurityPolicyInventorySummary(),
  );
});

test("prepared policy evidence produces the compatibility inventory summary", () => {
  const inputs = [
    artifact(
      "skills/demo/SKILL.md",
      "skill",
      policy({
        networkAllowed: false,
        securityProfile: "strict",
      }),
    ),
    artifact("skills/demo/scripts/run.mjs", "script", "echo safe\n"),
    artifact(
      "contexts/missing.md",
      "context",
      policy({ securityProfile: "missing-profile" }),
    ),
    artifact(
      "contexts/cyclic.md",
      "context",
      policy({ securityProfile: "cycle-a" }),
    ),
  ];
  const config = {
    ...baseSecurityConfig(),
    approvedDomains: ["shared.example.com"],
    profiles: {
      strict: profile({
        approvedDomains: ["shared.example.com"],
        forbiddenInputs: ["credentials"],
      }),
      "cycle-a": profile({ securityProfile: "cycle-b" }),
      "cycle-b": profile({ securityProfile: "cycle-a" }),
    },
  } satisfies SecurityConfig;
  const evidence = collectSecurityPolicyAssetEvidence(inputs, config);

  assert.equal(
    JSON.stringify(summarizeSecurityPolicyAssetEvidence(evidence)),
    JSON.stringify(summarizeSecurityPolicyInventory(inputs, config)),
  );
  assert.deepEqual(
    summarizeSecurityPolicyAssetEvidence([...evidence].reverse()),
    summarizeSecurityPolicyAssetEvidence(evidence),
  );
});

test("prepared policy evidence preserves raw effective list counting for compatibility", () => {
  const inputs = [
    artifact("contexts/raw-config.md", "context", "# Raw config\n"),
  ];
  const config = {
    ...baseSecurityConfig(),
    approvedDomains: [" shared.example.com ", "shared.example.com", ""],
    approvedUploadDomains: [" uploads.example.com ", "uploads.example.com"],
    disallowedCommands: [" curl ", "curl"],
  } satisfies SecurityConfig;
  const evidence = collectSecurityPolicyAssetEvidence(inputs, config);
  const summary = summarizeSecurityPolicyAssetEvidence(evidence);

  assert.deepEqual(summary, summarizeSecurityPolicyInventory(inputs, config));
  assert.equal(summary.approvedNetworkDestinationCount, 3);
  assert.equal(summary.approvedUploadDestinationCount, 2);
  assert.equal(summary.disallowedCommandCount, 2);
  assert.deepEqual(summary.topApprovedNetworkDestinations, [
    { destination: "", count: 1 },
    { destination: " shared.example.com ", count: 1 },
    { destination: "shared.example.com", count: 1 },
  ]);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /security-policy-summary-detail/,
  );
});

test("prepared policy evidence counts owning-Skill inheritance once per support asset", () => {
  const evidence = collectSecurityPolicyAssetEvidence([
    artifact(
      "skills/demo/SKILL.md",
      "skill",
      policy({ networkAllowed: false }),
    ),
    artifact("skills/demo/scripts/run.mjs", "script", "echo safe\n"),
    artifact("skills/demo/assets/input.json", "asset", "{}\n"),
  ]);
  const summary = summarizeSecurityPolicyAssetEvidence(evidence);

  assert.equal(summary.assetsWithInheritedPolicy, 2);
  assert.equal(summary.policySources.owning_skill, 2);
});

test("effective policy provenance lists every contributing source", () => {
  const config = {
    ...baseSecurityConfig(),
    disallowedCommands: ["curl"],
    profiles: {
      strict: {
        networkAllowed: false,
        allowedData: [],
        forbiddenInputs: [],
        approvedDomains: [],
        approvedUploadDomains: [],
        disallowedCommands: [],
      },
    },
  } satisfies SecurityConfig;
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({
          allowedData: "public",
          externalUploadAllowed: false,
          securityProfile: "strict",
        }),
      ),
      artifact("skills/demo/scripts/run.mjs", "script", "echo safe\n"),
    ],
    config,
  );

  assert.deepEqual(
    evidence.find((item) => item.kind === "skill")?.policySources,
    ["local", "security_profile", "repository_config"],
  );
  assert.deepEqual(
    evidence.find((item) => item.kind === "script")?.policySources,
    ["local", "security_profile", "repository_config", "owning_skill"],
  );
  assert.ok(
    evidence
      .filter((item) => item.hasEffectivePolicy)
      .every((item) => item.policySources.length > 0),
  );
  const summary = summarizeSecurityPolicyInventory(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({
          allowedData: "public",
          externalUploadAllowed: false,
          securityProfile: "strict",
        }),
      ),
      artifact("skills/demo/scripts/run.mjs", "script", "echo safe\n"),
    ],
    config,
  );
  assert.ok(
    summary.assetsWithEffectivePolicy <=
      Object.values(summary.policySources).reduce(
        (total, count) => total + count,
        0,
      ),
  );
});

test("policy provenance follows effective override and accumulation semantics", () => {
  const sameScalar = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/same-scalar.md",
        "context",
        policy({ networkAllowed: false, securityProfile: "strict" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: { strict: profile({ networkAllowed: false }) },
    },
  )[0];
  assert.deepEqual(sameScalar?.policySources, ["local"]);

  const overridden = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/override.md",
        "context",
        policy({ networkAllowed: false, securityProfile: "permissive" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: { permissive: profile({ networkAllowed: true }) },
    },
  )[0];
  assert.deepEqual(overridden?.policySources, ["local"]);

  const partial = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/partial.md",
        "context",
        policy({ networkAllowed: false, securityProfile: "mixed" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: {
        mixed: profile({ networkAllowed: true, forbiddenInputs: ["secret"] }),
      },
    },
  )[0];
  assert.deepEqual(partial?.policySources, ["local", "security_profile"]);

  const accumulated = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/accumulated.md",
        "context",
        [
          "---",
          "network_allowed: true",
          "approved_network_destinations: local.example.com",
          "---",
          "# Accumulated",
        ].join("\n"),
      ),
    ],
    {
      ...baseSecurityConfig(),
      approvedDomains: ["repo.example.com"],
    },
  )[0];
  assert.deepEqual(accumulated?.policySources, ["local", "repository_config"]);
  assert.deepEqual(accumulated?.effectivePolicy.approvedNetworkDestinations, [
    "local.example.com",
    "repo.example.com",
  ]);

  const chained = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/chained.md",
        "context",
        policy({ securityProfile: "child" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: {
        child: profile({ networkAllowed: true, securityProfile: "parent" }),
        parent: profile({ networkAllowed: true }),
      },
    },
  )[0];
  assert.deepEqual(chained?.policySources, ["security_profile"]);
  assert.equal(chained?.effectivePolicy.networkAllowed, true);
});

test("duplicate profile and repository list values retain both suppliers", () => {
  const config = {
    ...baseSecurityConfig(),
    approvedDomains: ["shared.example.com"],
    disallowedCommands: ["curl"],
    profiles: {
      strict: profile({
        approvedDomains: ["shared.example.com"],
        disallowedCommands: ["curl"],
      }),
    },
  } satisfies SecurityConfig;
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/profile-repository.md",
        "context",
        policy({ securityProfile: "strict" }),
      ),
    ],
    config,
  )[0];
  assert.deepEqual(evidence?.policySources, [
    "security_profile",
    "repository_config",
  ]);
  assert.deepEqual(evidence?.effectivePolicy.approvedNetworkDestinations, [
    "shared.example.com",
  ]);
  assert.deepEqual(evidence?.effectivePolicy.disallowedCommands, ["curl"]);
});

test("explicit local empty allowed data blocks profile inheritance with provenance", () => {
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/empty-data.md",
        "context",
        [
          "---",
          "allowed_data: []",
          "network_allowed: false",
          "security_profile: broad",
          "---",
          "# Empty data",
        ].join("\n"),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: { broad: profile({ allowedData: ["public"] }) },
    },
  )[0];
  assert.deepEqual(evidence?.policySources, ["local"]);
  assert.deepEqual(evidence?.effectivePolicy.allowedData, []);
});

test("repository-only and local-only policies report one exact source", () => {
  const localOnly = collectSecurityPolicyAssetEvidence([
    artifact("contexts/local.md", "context", policy({ networkAllowed: false })),
  ])[0];
  const repositoryOnly = collectSecurityPolicyAssetEvidence(
    [artifact("contexts/repository.md", "context", "# Repository\n")],
    { ...baseSecurityConfig(), disallowedCommands: ["curl"] },
  )[0];
  assert.deepEqual(localOnly?.policySources, ["local"]);
  assert.deepEqual(repositoryOnly?.policySources, ["repository_config"]);
});

test("duplicate policy values retain every supplying source", () => {
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "contexts/duplicate.md",
        "context",
        [
          "---",
          "approved_network_destinations: shared.example.com",
          "---",
          "# Duplicate",
        ].join("\n"),
      ),
    ],
    {
      ...baseSecurityConfig(),
      approvedDomains: ["shared.example.com"],
    },
  )[0];
  assert.deepEqual(evidence?.policySources, ["local", "repository_config"]);
  assert.ok(evidence);
  const summary = summarizeSecurityPolicyAssetEvidence([evidence]);
  assert.equal(summary.approvedNetworkDestinationCount, 1);
  assert.deepEqual(summary.topApprovedNetworkDestinations, [
    { destination: "shared.example.com", count: 1 },
  ]);
});

test("invalid local destination metadata blocks repository accumulation provenance", () => {
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        [
          "---",
          "metadata:",
          '  renma.network-allowed: "false"',
          '  renma.approved-network-destinations: "not-json"',
          "---",
          "# Demo",
        ].join("\n"),
      ),
    ],
    {
      ...baseSecurityConfig(),
      approvedDomains: ["repo.example.com"],
    },
  )[0];
  assert.deepEqual(evidence?.policySources, ["local"]);
  assert.deepEqual(evidence?.effectivePolicy.approvedNetworkDestinations, []);
  assert.ok(evidence);
  const summary = summarizeSecurityPolicyAssetEvidence([evidence]);
  assert.equal(summary.approvedNetworkDestinationCount, 0);
  assert.deepEqual(summary.topApprovedNetworkDestinations, []);
});

test("skill and context without policy metadata are counted as missing", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact("skills/demo/SKILL.md", "skill", "# Demo\n"),
    artifact("contexts/testing/demo.md", "context", "# Demo\n"),
    artifact("lenses/testing/demo.md", "context_lens", "# Demo\n"),
  ]);

  assert.equal(summary.totalPolicyAssets, 3);
  assert.equal(summary.assetsWithLocalPolicyMetadata, 0);
  assert.equal(summary.assetsWithoutEffectivePolicy, 3);
  assert.equal(summary.assetKinds.skill, 1);
  assert.equal(summary.assetKinds.context, 1);
  assert.equal(summary.assetKinds.context_lens, 1);
  assert.equal(summary.networkAllowed.unspecified, 3);
  assert.equal(summary.securityProfiles.none, 3);
  assert.deepEqual(summary.assetsWithoutEffectivePolicyList, [
    { path: "contexts/testing/demo.md", kind: "context" },
    { path: "lenses/testing/demo.md", kind: "context_lens" },
    { path: "skills/demo/SKILL.md", kind: "skill" },
  ]);
});

test("floating allowances are visible as local policy metadata with exact evidence", () => {
  const nonSkillContent = [
    "---",
    "allowed_floating_dependencies:",
    "  - npm:appium@latest",
    "---",
    "# Context",
  ].join("\n");
  const canonicalSkillContent = [
    "---",
    "name: demo",
    "description: Use this skill for deterministic floating allowance inventory checks when local governance evidence must remain auditable.",
    "metadata:",
    `  renma.allowed-floating-dependencies: '["npm:appium@latest"]'`,
    "---",
    "# Demo",
  ].join("\n");
  const evidence = collectSecurityPolicyAssetEvidence([
    exactArtifact("contexts/allowance.md", "context", nonSkillContent),
    exactArtifact("skills/demo/SKILL.md", "skill", canonicalSkillContent),
  ]);
  const nonSkill = evidence.find(
    ({ path }) => path === "contexts/allowance.md",
  );
  const canonicalSkill = evidence.find(
    ({ path }) => path === "skills/demo/SKILL.md",
  );

  assert.equal(nonSkill?.hasLocalPolicyMetadata, true);
  assert.equal(nonSkill?.hasEffectivePolicy, false);
  assert.deepEqual(nonSkill?.policySources, []);
  assert.deepEqual(nonSkill?.evidence.policyFields, [
    {
      path: "contexts/allowance.md",
      startLine: 2,
      endLine: 3,
      snippet: "allowed_floating_dependencies:\n  - npm:appium@latest",
    },
  ]);

  assert.equal(canonicalSkill?.hasLocalPolicyMetadata, true);
  assert.equal(canonicalSkill?.hasEffectivePolicy, false);
  assert.deepEqual(canonicalSkill?.policySources, []);
  assert.deepEqual(canonicalSkill?.evidence.policyFields, [
    {
      path: "skills/demo/SKILL.md",
      startLine: 5,
      endLine: 5,
      snippet: `  renma.allowed-floating-dependencies: '["npm:appium@latest"]'`,
    },
  ]);
});

test("floating allowance inventory stays asset-local and fingerprint-neutral", () => {
  const allowance = (selector: string) =>
    [
      "---",
      "allowed_floating_dependencies:",
      `  - ${selector}`,
      "---",
      "# Context",
    ].join("\n");
  const evidence = collectSecurityPolicyAssetEvidence([
    exactArtifact(
      "contexts/latest.md",
      "context",
      allowance("npm:appium@latest"),
    ),
    exactArtifact("contexts/next.md", "context", allowance("npm:appium@next")),
    exactArtifact("contexts/plain.md", "context", "# Plain\n"),
  ]);
  const latest = evidence.find(({ path }) => path === "contexts/latest.md");
  const next = evidence.find(({ path }) => path === "contexts/next.md");
  const plain = evidence.find(({ path }) => path === "contexts/plain.md");

  assert.equal(latest?.hasLocalPolicyMetadata, true);
  assert.equal(next?.hasLocalPolicyMetadata, true);
  assert.equal(plain?.hasLocalPolicyMetadata, false);
  assert.equal(
    latest?.effectivePolicy.fingerprint,
    next?.effectivePolicy.fingerprint,
  );
  assert.equal(
    latest?.effectivePolicy.fingerprint,
    plain?.effectivePolicy.fingerprint,
  );
  assert.equal(
    "allowedFloatingDependencies" in (latest?.effectivePolicy ?? {}),
    false,
  );
  assert.deepEqual(plain?.evidence.policyFields, []);

  const summary = summarizeSecurityPolicyAssetEvidence(evidence);
  assert.equal(summary.totalPolicyAssets, 3);
  assert.equal(summary.assetsWithLocalPolicyMetadata, 2);
  assert.equal(summary.assetsWithEffectivePolicy, 0);
  assert.equal(summary.assetsWithoutEffectivePolicy, 3);
  assert.deepEqual(summary.networkAllowed, {
    true: 0,
    false: 0,
    unspecified: 3,
  });
  assert.equal(summary.approvedNetworkDestinationCount, 0);
  assert.equal(summary.approvedUploadDestinationCount, 0);
  assert.equal(summary.forbiddenInputCount, 0);
  assert.equal(summary.disallowedCommandCount, 0);
  assert.deepEqual(
    Object.keys(summary),
    Object.keys(zeroSecurityPolicyInventorySummary()),
  );
  assert.deepEqual(Object.keys(latest?.effectivePolicy ?? {}), [
    "fingerprint",
    "allowedData",
    "forbiddenInputs",
    "networkAllowed",
    "externalUploadAllowed",
    "secretsAllowed",
    "humanApprovalRequired",
    "approvedNetworkDestinations",
    "approvedUploadDestinations",
    "disallowedCommands",
  ]);
});

test("profiles and repository config cannot supply or accumulate floating allowances", () => {
  const unsupportedConfig = {
    ...baseSecurityConfig(),
    allowedFloatingDependencies: ["npm:repository-only@latest"],
    profiles: {
      strict: {
        ...profile({ networkAllowed: false }),
        allowedFloatingDependencies: ["npm:profile-only@latest"],
      },
    },
  } as unknown as SecurityConfig;
  const localContent = [
    "---",
    "security_profile: strict",
    "allowed_floating_dependencies:",
    "  - npm:appium@latest",
    "---",
    "# Local",
  ].join("\n");
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      exactArtifact("contexts/local.md", "context", localContent),
      exactArtifact(
        "contexts/profile.md",
        "context",
        "---\nsecurity_profile: strict\n---\n# Profile\n",
      ),
      exactArtifact("contexts/repository.md", "context", "# Repository\n"),
    ],
    unsupportedConfig,
  );
  const local = evidence.find(({ path }) => path === "contexts/local.md");
  const profileOnly = evidence.find(
    ({ path }) => path === "contexts/profile.md",
  );
  const repositoryOnly = evidence.find(
    ({ path }) => path === "contexts/repository.md",
  );

  assert.deepEqual(
    local?.evidence.policyFields.map(({ snippet }) => snippet),
    [
      "security_profile: strict",
      "allowed_floating_dependencies:\n  - npm:appium@latest",
    ],
  );
  assert.deepEqual(
    profileOnly?.evidence.policyFields.map(({ snippet }) => snippet),
    ["security_profile: strict"],
  );
  assert.deepEqual(repositoryOnly?.evidence.policyFields, []);
  assert.equal(
    local?.effectivePolicy.fingerprint,
    profileOnly?.effectivePolicy.fingerprint,
  );
  assert.deepEqual(local?.policySources, ["security_profile"]);
  assert.deepEqual(profileOnly?.policySources, ["security_profile"]);
  assert.equal(repositoryOnly?.hasLocalPolicyMetadata, false);
  assert.equal(repositoryOnly?.hasEffectivePolicy, false);
  assert.equal(JSON.stringify(evidence).includes("profile-only@latest"), false);
  assert.equal(
    JSON.stringify(evidence).includes("repository-only@latest"),
    false,
  );
});

test("asset-local booleans count true false and unspecified effective values", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact(
      "skills/one/SKILL.md",
      "skill",
      policy({
        allowedData: "public",
        networkAllowed: true,
        externalUploadAllowed: false,
        secretsAllowed: true,
        humanApprovalRequired: false,
      }),
    ),
    artifact(
      "skills/two/SKILL.md",
      "skill",
      policy({ allowedData: "public", networkAllowed: false }),
    ),
  ]);

  assert.deepEqual(summary.networkAllowed, {
    true: 1,
    false: 1,
    unspecified: 0,
  });
  assert.deepEqual(summary.externalUploadAllowed, {
    true: 0,
    false: 1,
    unspecified: 1,
  });
  assert.deepEqual(summary.secretsAllowed, {
    true: 1,
    false: 0,
    unspecified: 1,
  });
  assert.deepEqual(summary.humanApprovalRequired, {
    true: 0,
    false: 1,
    unspecified: 1,
  });
});

test("external upload governance counts all five effective states", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact(
      "skills/denied/SKILL.md",
      "skill",
      policy({
        externalUploadAllowed: false,
        humanApprovalRequired: true,
      }),
    ),
    artifact(
      "skills/approval-required/SKILL.md",
      "skill",
      policy({
        externalUploadAllowed: true,
        humanApprovalRequired: true,
      }),
    ),
    artifact(
      "skills/approval-not-required/SKILL.md",
      "skill",
      policy({
        externalUploadAllowed: true,
        humanApprovalRequired: false,
      }),
    ),
    artifact(
      "skills/approval-unspecified/SKILL.md",
      "skill",
      policy({ externalUploadAllowed: true }),
    ),
    artifact(
      "skills/upload-unspecified/SKILL.md",
      "skill",
      policy({ humanApprovalRequired: true }),
    ),
  ]);

  assert.deepEqual(summary.externalUploadGovernance, {
    denied: 1,
    allowedApprovalRequired: 1,
    allowedNoApprovalRequired: 1,
    allowedApprovalUnspecified: 1,
    unspecified: 1,
  });
  assert.equal(
    Object.values(summary.externalUploadGovernance).reduce(
      (total, count) => total + count,
      0,
    ),
    summary.totalPolicyAssets,
  );
  assert.equal(
    summary.externalUploadAllowed.true +
      summary.externalUploadAllowed.false +
      summary.externalUploadAllowed.unspecified,
    summary.totalPolicyAssets,
  );
  assert.equal(
    summary.humanApprovalRequired.true +
      summary.humanApprovalRequired.false +
      summary.humanApprovalRequired.unspecified,
    summary.totalPolicyAssets,
  );
});

test("upload denial wins and approval never implies unspecified permission", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact(
      "skills/denied/SKILL.md",
      "skill",
      policy({
        externalUploadAllowed: false,
        humanApprovalRequired: false,
      }),
    ),
    artifact(
      "skills/unspecified/SKILL.md",
      "skill",
      policy({ humanApprovalRequired: false }),
    ),
  ]);

  assert.deepEqual(summary.externalUploadGovernance, {
    denied: 1,
    allowedApprovalRequired: 0,
    allowedNoApprovalRequired: 0,
    allowedApprovalUnspecified: 0,
    unspecified: 1,
  });
});

test("destinations and forbidden inputs are deduped per asset", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact(
      "skills/one/SKILL.md",
      "skill",
      [
        "---",
        "allowed_data: public",
        "approved_network_destinations: api.example.com, api.example.com, cdn.example.com",
        "approved_upload_destinations: uploads.example.com, uploads.example.com",
        "forbidden_inputs: credentials, secrets, credentials",
        "---",
        "# One",
      ].join("\n"),
    ),
    artifact(
      "skills/two/SKILL.md",
      "skill",
      [
        "---",
        "allowed_data: public",
        "approved_network_destinations: api.example.com",
        "approved_upload_destinations: artifacts.example.com",
        "forbidden_inputs: secrets",
        "---",
        "# Two",
      ].join("\n"),
    ),
  ]);

  assert.equal(summary.approvedNetworkDestinationCount, 3);
  assert.equal(summary.approvedUploadDestinationCount, 2);
  assert.equal(summary.forbiddenInputCount, 3);
  assert.deepEqual(summary.topApprovedNetworkDestinations, [
    { destination: "api.example.com", count: 2 },
    { destination: "cdn.example.com", count: 1 },
  ]);
  assert.deepEqual(summary.topApprovedUploadDestinations, [
    { destination: "artifacts.example.com", count: 1 },
    { destination: "uploads.example.com", count: 1 },
  ]);
  assert.deepEqual(summary.topForbiddenInputs, [
    { input: "secrets", count: 2 },
    { input: "credentials", count: 1 },
  ]);
});

test("security policy parser only recognizes canonical frontmatter keys", () => {
  const parsed = parseSecurityPolicy(
    [
      "---",
      "allowedData: public",
      "networkAllowed: true",
      "externalUploadAllowed: true",
      "secretsAllowed: true",
      "human_approval_required: true",
      "requiresHumanApproval: true",
      "approvedNetworkDestinations: api.example.com",
      "allowedNetworkDestinations: cdn.example.com",
      "approvedUploadDestinations: uploads.example.com",
      "approved_upload_domains: artifacts.example.com",
      "forbiddenInputs: secrets",
      "securityProfile: strict-local",
      "---",
      "# Demo",
    ].join("\n"),
  );

  assert.equal(parsed.declared.size, 0);
  assert.equal(parsed.networkAllowed, undefined);
  assert.equal(parsed.externalUploadAllowed, undefined);
  assert.equal(parsed.secretsAllowed, undefined);
  assert.equal(parsed.humanApprovalRequired, undefined);
  assert.equal(parsed.securityProfile, undefined);
  assert.deepEqual(parsed.allowedData, []);
  assert.deepEqual(parsed.approvedNetworkDestinations, []);
  assert.deepEqual(parsed.approvedUploadDestinations, []);
  assert.deepEqual(parsed.forbiddenInputs, []);
});

test("repo-level security config is reflected in effective policy lists", () => {
  const summary = summarizeSecurityPolicyInventory(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({ allowedData: "public" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      approvedDomains: ["api.example.com"],
      approvedUploadDomains: ["uploads.example.com"],
      disallowedCommands: ["curl"],
    },
  );

  assert.equal(summary.approvedNetworkDestinationCount, 1);
  assert.equal(summary.approvedUploadDestinationCount, 1);
  assert.equal(summary.disallowedCommandCount, 1);
  assert.deepEqual(summary.topApprovedNetworkDestinations, [
    { destination: "api.example.com", count: 1 },
  ]);
  assert.deepEqual(summary.topApprovedUploadDestinations, [
    { destination: "uploads.example.com", count: 1 },
  ]);
});

test("resolved security profiles count as referenced and contribute policy", () => {
  const summary = summarizeSecurityPolicyInventory(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({ securityProfile: "strict-local" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: {
        "strict-local": {
          networkAllowed: false,
          externalUploadAllowed: false,
          secretsAllowed: false,
          humanApprovalRequired: true,
          allowedData: ["disclosed", "sanitized diagnostics"],
          forbiddenInputs: ["credentials"],
          approvedDomains: ["docs.example.com"],
          approvedUploadDomains: ["uploads.example.com"],
          disallowedCommands: ["curl"],
        },
      },
    },
  );

  assert.equal(summary.securityProfiles.referenced, 1);
  assert.equal(summary.securityProfiles.resolved, 1);
  assert.equal(summary.securityProfiles.missing, 0);
  assert.equal(summary.securityProfiles.cyclic, 0);
  assert.deepEqual(summary.securityProfiles.names, [
    { name: "strict-local", count: 1 },
  ]);
  assert.deepEqual(summary.networkAllowed, {
    true: 0,
    false: 1,
    unspecified: 0,
  });
  assert.equal(summary.assetsWithoutEffectivePolicy, 0);
  assert.equal(summary.forbiddenInputCount, 1);
  assert.equal(summary.approvedNetworkDestinationCount, 1);
  assert.equal(summary.approvedUploadDestinationCount, 1);
  assert.equal(summary.disallowedCommandCount, 1);
});

test("external upload governance uses profile-resolved and local effective values", () => {
  const inputs = [
    artifact(
      "skills/profile-upload/SKILL.md",
      "skill",
      policy({
        securityProfile: "upload-permitted",
        humanApprovalRequired: true,
      }),
    ),
  ];
  const config = {
    ...baseSecurityConfig(),
    profiles: {
      "upload-permitted": profile({ externalUploadAllowed: true }),
    },
  } satisfies SecurityConfig;
  const evidence = collectSecurityPolicyAssetEvidence(inputs, config);
  const asset = evidence[0];
  const summary = summarizeSecurityPolicyAssetEvidence(evidence);

  assert.equal(asset?.declaredPolicy?.externalUploadAllowed, null);
  assert.equal(asset?.declaredPolicy?.humanApprovalRequired, true);
  assert.equal(asset?.effectivePolicy.externalUploadAllowed, true);
  assert.equal(asset?.effectivePolicy.humanApprovalRequired, true);
  assert.deepEqual(asset?.policySources, ["local", "security_profile"]);
  assert.deepEqual(summary.externalUploadGovernance, {
    denied: 0,
    allowedApprovalRequired: 1,
    allowedNoApprovalRequired: 0,
    allowedApprovalUnspecified: 0,
    unspecified: 0,
  });
});

test("missing security profiles increment missing profile counts", () => {
  const summary = summarizeSecurityPolicyInventory(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({ securityProfile: "missing-profile" }),
      ),
    ],
    baseSecurityConfig(),
  );

  assert.equal(summary.securityProfiles.referenced, 1);
  assert.equal(summary.securityProfiles.resolved, 0);
  assert.equal(summary.securityProfiles.missing, 1);
  assert.equal(summary.securityProfiles.cyclic, 0);
});

test("cyclic security profiles increment cyclic profile counts", () => {
  const summary = summarizeSecurityPolicyInventory(
    [
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        policy({ securityProfile: "a" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: {
        a: profile({ securityProfile: "b" }),
        b: profile({ securityProfile: "a" }),
      },
    },
  );

  assert.equal(summary.securityProfiles.referenced, 1);
  assert.equal(summary.securityProfiles.resolved, 0);
  assert.equal(summary.securityProfiles.missing, 0);
  assert.equal(summary.securityProfiles.cyclic, 1);
});

test("prepared policy evidence retains missing and cyclic profile counts", () => {
  const evidence = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        "skills/missing/SKILL.md",
        "skill",
        policy({ securityProfile: "missing-profile" }),
      ),
      artifact(
        "skills/cyclic/SKILL.md",
        "skill",
        policy({ securityProfile: "a" }),
      ),
    ],
    {
      ...baseSecurityConfig(),
      profiles: {
        a: profile({ securityProfile: "b" }),
        b: profile({ securityProfile: "a" }),
      },
    },
  );
  const summary = summarizeSecurityPolicyAssetEvidence(evidence);

  assert.equal(summary.securityProfiles.referenced, 2);
  assert.equal(summary.securityProfiles.resolved, 0);
  assert.equal(summary.securityProfiles.missing, 1);
  assert.equal(summary.securityProfiles.cyclic, 1);
  assert.equal(summary.securityProfiles.none, 0);
});

test("unknown artifacts are included only when they declare policy metadata", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact("notes/plain.md", "unknown", "# Plain\n"),
    artifact(
      "notes/policy.md",
      "unknown",
      policy({ allowedData: "public", networkAllowed: true }),
    ),
  ]);

  assert.equal(summary.totalPolicyAssets, 1);
  assert.equal(summary.assetKinds.unknown, 1);
  assert.equal(summary.assetsWithLocalPolicyMetadata, 1);
  assert.deepEqual(summary.networkAllowed, {
    true: 1,
    false: 0,
    unspecified: 0,
  });
});

test("top lists sort by count then name and are limited to ten", () => {
  const destinations = [
    "b.example.com",
    "a.example.com",
    "c.example.com",
    "d.example.com",
    "e.example.com",
    "f.example.com",
    "g.example.com",
    "h.example.com",
    "i.example.com",
    "j.example.com",
    "k.example.com",
    "l.example.com",
  ];
  const artifacts = destinations.map((destination, index) =>
    artifact(
      `skills/demo-${index}/SKILL.md`,
      "skill",
      [
        "---",
        "allowed_data: public",
        `approved_network_destinations: ${destination}`,
        "---",
        "# Demo",
      ].join("\n"),
    ),
  );
  artifacts.push(
    artifact(
      "skills/dupe/SKILL.md",
      "skill",
      [
        "---",
        "allowed_data: public",
        "approved_network_destinations: b.example.com",
        "---",
        "# Dupe",
      ].join("\n"),
    ),
  );

  const summary = summarizeSecurityPolicyInventory(artifacts);

  assert.equal(summary.topApprovedNetworkDestinations.length, 10);
  assert.deepEqual(summary.topApprovedNetworkDestinations, [
    { destination: "b.example.com", count: 2 },
    { destination: "a.example.com", count: 1 },
    { destination: "c.example.com", count: 1 },
    { destination: "d.example.com", count: 1 },
    { destination: "e.example.com", count: 1 },
    { destination: "f.example.com", count: 1 },
    { destination: "g.example.com", count: 1 },
    { destination: "h.example.com", count: 1 },
    { destination: "i.example.com", count: 1 },
    { destination: "j.example.com", count: 1 },
  ]);
});

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  const operationalContent =
    kind === "skill" ? canonicalSkillFixture(path, content) : content;
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(operationalContent),
    contentClassification: "text",
    markdownParserEligible: true,
    content: operationalContent,
  };
}

function exactArtifact(
  path: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

function policy(options: {
  allowedData?: string;
  networkAllowed?: boolean;
  externalUploadAllowed?: boolean;
  secretsAllowed?: boolean;
  humanApprovalRequired?: boolean;
  securityProfile?: string;
}): string {
  return [
    "---",
    ...(options.allowedData ? [`allowed_data: ${options.allowedData}`] : []),
    ...(options.networkAllowed === undefined
      ? []
      : [`network_allowed: ${options.networkAllowed}`]),
    ...(options.externalUploadAllowed === undefined
      ? []
      : [`external_upload_allowed: ${options.externalUploadAllowed}`]),
    ...(options.secretsAllowed === undefined
      ? []
      : [`secrets_allowed: ${options.secretsAllowed}`]),
    ...(options.humanApprovalRequired === undefined
      ? []
      : [`requires_human_approval: ${options.humanApprovalRequired}`]),
    ...(options.securityProfile
      ? [`security_profile: ${options.securityProfile}`]
      : []),
    "---",
    "# Demo",
  ].join("\n");
}

function baseSecurityConfig(): SecurityConfig {
  return {
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    profiles: {},
  };
}

function profile(
  options: Partial<NonNullable<SecurityConfig["profiles"]>[string]> = {},
): NonNullable<SecurityConfig["profiles"]>[string] {
  return {
    allowedData: [],
    forbiddenInputs: [],
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    ...options,
  };
}
