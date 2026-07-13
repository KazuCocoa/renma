import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSecurityPolicyAssetEvidence,
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
