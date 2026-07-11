import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("skill and context without policy metadata are counted as missing", () => {
  const summary = summarizeSecurityPolicyInventory([
    artifact("skills/demo/SKILL.md", "skill", "# Demo\n"),
    artifact("contexts/testing/demo.md", "context", "# Demo\n"),
    artifact("lenses/testing/demo.md", "context_lens", "# Demo\n"),
  ]);

  assert.equal(summary.totalPolicyAssets, 3);
  assert.equal(summary.assetsWithPolicyMetadata, 0);
  assert.equal(summary.assetsMissingPolicyMetadata, 3);
  assert.equal(summary.assetKinds.skill, 1);
  assert.equal(summary.assetKinds.context, 1);
  assert.equal(summary.assetKinds.context_lens, 1);
  assert.equal(summary.networkAllowed.unspecified, 3);
  assert.equal(summary.securityProfiles.none, 3);
  assert.deepEqual(summary.missingPolicyAssets, [
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
  assert.equal(summary.assetsMissingPolicyMetadata, 0);
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
  assert.equal(summary.assetsWithPolicyMetadata, 1);
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

test("hybrid Skill security metadata is not operational", () => {
  const legacy = [
    "network_allowed: true",
    "external_upload_allowed: true",
    "secrets_allowed: true",
    "requires_human_approval: false",
    "allowed_data: legacy",
    "forbidden_inputs: legacy-secret",
    "approved_network_destinations: stale.example",
    "approved_upload_destinations: stale-upload.example",
    "security_profile: legacy-profile",
  ];
  const canonical = [
    "metadata:",
    "  renma.network-allowed: 'false'",
    "  renma.external-upload-allowed: 'false'",
    "  renma.secrets-allowed: 'false'",
    "  renma.requires-human-approval: 'true'",
    "  renma.allowed-data: '[\"canonical\"]'",
    "  renma.forbidden-inputs: '[\"canonical-secret\"]'",
    "  renma.approved-network-destinations: '[\"safe.example\"]'",
    "  renma.approved-upload-destinations: '[\"safe-upload.example\"]'",
    "  renma.security-profile: canonical-profile",
  ];

  for (const frontmatter of [
    [...legacy, ...canonical],
    [...canonical, ...legacy],
  ]) {
    const content = ["---", ...frontmatter, "---", "# Demo"].join("\n");
    const parsed = parseSecurityPolicy(content, "skill");
    const summary = summarizeSecurityPolicyInventory([
      rawArtifact("skills/demo/SKILL.md", "skill", content),
    ]);

    assert.equal(parsed.networkAllowed, undefined);
    assert.equal(parsed.externalUploadAllowed, undefined);
    assert.equal(parsed.secretsAllowed, undefined);
    assert.equal(parsed.humanApprovalRequired, undefined);
    assert.equal(parsed.securityProfile, undefined);
    assert.deepEqual(parsed.allowedData, []);
    assert.deepEqual(parsed.forbiddenInputs, []);
    assert.deepEqual(parsed.approvedNetworkDestinations, []);
    assert.deepEqual(parsed.approvedUploadDestinations, []);
    assert.deepEqual(summary.networkAllowed, {
      true: 0,
      false: 0,
      unspecified: 1,
    });
    assert.deepEqual(summary.topApprovedNetworkDestinations, []);
    assert.deepEqual(summary.topApprovedUploadDestinations, []);
  }
});

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content: kind === "skill" ? canonicalSkillFixture(path, content) : content,
  };
}

function rawArtifact(
  path: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
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
