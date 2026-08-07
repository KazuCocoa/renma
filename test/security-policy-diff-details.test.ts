import assert from "node:assert/strict";
import test from "node:test";

import { buildSecurityPolicyChanges } from "../src/security-policy-diff.js";
import { collectSecurityPolicyAssetEvidence } from "../src/security-policy-inventory.js";
import type {
  Artifact,
  ArtifactKind,
  SecurityConfig,
  SecurityProfileConfig,
} from "../src/types.js";

test("direct effective policy changes retain normalized scalar and list details", () => {
  const path = "contexts/review.md";
  const fromAssets = collectSecurityPolicyAssetEvidence([
    artifact(
      path,
      "context",
      policy({
        allowedData: ["public"],
        forbiddenInputs: ["credentials", "private-key"],
        networkAllowed: false,
        externalUploadAllowed: false,
        secretsAllowed: false,
        humanApprovalRequired: true,
        approvedNetworkDestinations: ["old.example.com"],
        approvedUploadDestinations: ["old-upload.example.com"],
      }),
    ),
  ]);
  const toAssets = collectSecurityPolicyAssetEvidence([
    artifact(
      path,
      "context",
      policy({
        allowedData: [" confidential ", "public", "confidential"],
        forbiddenInputs: ["private-key"],
        networkAllowed: true,
        externalUploadAllowed: true,
        secretsAllowed: true,
        humanApprovalRequired: false,
        approvedNetworkDestinations: ["new.example.com", " new.example.com "],
        approvedUploadDestinations: ["new-upload.example.com"],
      }),
    ),
  ]);

  const result = buildSecurityPolicyChanges({
    fromAssets,
    toAssets,
    fromAssetIdsByPath: new Map([[path, "context.review"]]),
    toAssetIdsByPath: new Map([[path, "context.review"]]),
  });

  assert.equal(result.policyChanges.length, 1);
  const change = result.policyChanges[0]!;
  assert.deepEqual(
    change.fields.map((field) => field.field),
    [
      "networkAllowed",
      "approvedNetworkDestinations",
      "externalUploadAllowed",
      "approvedUploadDestinations",
      "allowedData",
      "forbiddenInputs",
      "secretsAllowed",
      "humanApprovalRequired",
    ],
  );
  assert.deepEqual(change.fields[0], {
    kind: "scalar",
    field: "networkAllowed",
    before: false,
    after: true,
    provenance: {
      mode: "direct",
      sources: [{ type: "asset", id: "context.review", path }],
    },
  });
  assert.deepEqual(change.fields[1], {
    kind: "list",
    field: "approvedNetworkDestinations",
    added: ["new.example.com"],
    removed: ["old.example.com"],
    provenance: {
      mode: "direct",
      sources: [{ type: "asset", id: "context.review", path }],
    },
  });
  assert.deepEqual(
    change.fields.find((field) => field.field === "allowedData"),
    {
      kind: "list",
      field: "allowedData",
      added: ["confidential"],
      removed: [],
      provenance: {
        mode: "direct",
        sources: [{ type: "asset", id: "context.review", path }],
      },
    },
  );
  assert.deepEqual(
    change.fields.find((field) => field.field === "forbiddenInputs"),
    {
      kind: "list",
      field: "forbiddenInputs",
      added: [],
      removed: ["credentials"],
      provenance: {
        mode: "direct",
        sources: [{ type: "asset", id: "context.review", path }],
      },
    },
  );
  assert.equal(change.before?.networkAllowed, false);
  assert.equal(change.after?.networkAllowed, true);
  assert.deepEqual(change.after?.approvedNetworkDestinations, [
    "new.example.com",
  ]);
  assert.equal(JSON.stringify(result).includes("fingerprint"), false);
  assert.deepEqual(result.sharedPolicyChanges, []);
});

test("profile changes report inherited provenance and complete sorted blast radius", () => {
  const inputs = [
    artifact(
      "contexts/zeta.md",
      "context",
      policy({ securityProfile: "shared" }),
    ),
    artifact(
      "contexts/alpha.md",
      "context",
      policy({ securityProfile: "shared" }),
    ),
  ];
  const fromConfig = securityConfig({
    profiles: {
      shared: profile({
        allowedData: ["public"],
        forbiddenInputs: ["credentials"],
        networkAllowed: false,
        externalUploadAllowed: false,
        secretsAllowed: false,
        humanApprovalRequired: true,
        approvedDomains: ["old.example.com"],
        approvedUploadDomains: ["old-upload.example.com"],
        disallowedCommands: ["curl"],
      }),
    },
  });
  const toConfig = securityConfig({
    profiles: {
      shared: profile({
        allowedData: ["internal", " internal ", "public"],
        forbiddenInputs: [],
        networkAllowed: true,
        externalUploadAllowed: true,
        secretsAllowed: true,
        humanApprovalRequired: false,
        approvedDomains: ["new.example.com", "new.example.com"],
        approvedUploadDomains: ["new-upload.example.com"],
        disallowedCommands: [],
      }),
    },
  });
  const ids = new Map([
    ["contexts/zeta.md", "context.zeta"],
    ["contexts/alpha.md", "context.alpha"],
  ]);

  const result = buildSecurityPolicyChanges({
    fromAssets: collectSecurityPolicyAssetEvidence(inputs, fromConfig),
    toAssets: collectSecurityPolicyAssetEvidence(inputs, toConfig),
    fromConfig,
    toConfig,
    fromConfigPath: "renma.config.jsonc",
    toConfigPath: "renma.config.jsonc",
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });

  assert.deepEqual(
    result.policyChanges.map(({ asset }) => asset.id),
    ["context.alpha", "context.zeta"],
  );
  assert.ok(
    result.policyChanges.every((change) =>
      change.fields.every(
        (field) =>
          field.provenance.mode === "inherited" &&
          field.provenance.sources.some(
            (source) =>
              source.type === "security_profile" && source.id === "shared",
          ),
      ),
    ),
  );
  assert.deepEqual(result.sharedPolicyChanges, [
    {
      source: {
        type: "security_profile",
        id: "shared",
        path: "renma.config.jsonc",
      },
      changedFields: [
        "networkAllowed",
        "approvedNetworkDestinations",
        "externalUploadAllowed",
        "approvedUploadDestinations",
        "allowedData",
        "forbiddenInputs",
        "secretsAllowed",
        "humanApprovalRequired",
        "disallowedCommands",
      ],
      affectedAssets: [
        { id: "context.alpha", path: "contexts/alpha.md", kind: "context" },
        { id: "context.zeta", path: "contexts/zeta.md", kind: "context" },
      ],
    },
  ]);
  const commands = result.policyChanges[0]!.fields.find(
    (field) => field.field === "disallowedCommands",
  );
  assert.deepEqual(commands && "removed" in commands ? commands.removed : [], [
    "curl",
  ]);
});

test("repository destinations and command policy changes name repository provenance", () => {
  const inputs = [artifact("contexts/repo.md", "context", "# Repo\n")];
  const fromConfig = securityConfig({
    approvedDomains: ["old.example.com"],
    approvedUploadDomains: ["old-upload.example.com"],
    disallowedCommands: ["curl", "wget"],
  });
  const toConfig = securityConfig({
    approvedDomains: ["new.example.com"],
    approvedUploadDomains: ["new-upload.example.com"],
    disallowedCommands: ["wget"],
  });

  const result = buildSecurityPolicyChanges({
    fromAssets: collectSecurityPolicyAssetEvidence(inputs, fromConfig),
    toAssets: collectSecurityPolicyAssetEvidence(inputs, toConfig),
    fromConfig,
    toConfig,
    fromConfigPath: "renma.config.json",
    toConfigPath: "renma.config.json",
  });

  assert.equal(result.policyChanges.length, 1);
  assert.deepEqual(
    result.policyChanges[0]!.fields.map((field) => field.field),
    [
      "approvedNetworkDestinations",
      "approvedUploadDestinations",
      "disallowedCommands",
    ],
  );
  assert.ok(
    result.policyChanges[0]!.fields.every(
      (field) =>
        field.provenance.mode === "inherited" &&
        field.provenance.sources[0]?.type === "repository_config",
    ),
  );
  assert.deepEqual(
    result.sharedPolicyChanges.map((change) => change.source.type),
    ["repository_config"],
  );
});

test("removing a local override records direct declaration and inherited profile provenance", () => {
  const path = "contexts/mixed.md";
  const config = securityConfig({
    profiles: {
      shared: profile({ allowedData: ["profile-data"] }),
    },
  });
  const fromAssets = collectSecurityPolicyAssetEvidence(
    [
      artifact(
        path,
        "context",
        policy({ securityProfile: "shared", allowedData: ["local-data"] }),
      ),
    ],
    config,
  );
  const toAssets = collectSecurityPolicyAssetEvidence(
    [artifact(path, "context", policy({ securityProfile: "shared" }))],
    config,
  );

  const result = buildSecurityPolicyChanges({
    fromAssets,
    toAssets,
    fromConfig: config,
    toConfig: config,
    fromConfigPath: "renma.config.jsonc",
    toConfigPath: "renma.config.jsonc",
    fromAssetIdsByPath: new Map([[path, "context.mixed"]]),
    toAssetIdsByPath: new Map([[path, "context.mixed"]]),
  });

  assert.deepEqual(result.policyChanges[0]?.fields, [
    {
      kind: "list",
      field: "allowedData",
      added: ["profile-data"],
      removed: ["local-data"],
      provenance: {
        mode: "mixed",
        sources: [
          { type: "asset", id: "context.mixed", path },
          {
            type: "security_profile",
            id: "shared",
            path: "renma.config.jsonc",
          },
        ],
      },
    },
  ]);
  assert.deepEqual(result.sharedPolicyChanges, []);
});

test("owning Skill changes distinguish direct Skill and inherited support assets", () => {
  const skillPath = "skills/demo/SKILL.md";
  const scriptPath = "skills/demo/scripts/run.mjs";
  const ids = new Map([
    [skillPath, "skill.demo"],
    [scriptPath, "script.demo.run"],
  ]);
  const fromInputs = [
    artifact(skillPath, "skill", skillPolicy(false)),
    artifact(scriptPath, "script", "console.log('safe');\n"),
  ];
  const toInputs = [
    artifact(skillPath, "skill", skillPolicy(true)),
    artifact(scriptPath, "script", "console.log('safe');\n"),
  ];

  const result = buildSecurityPolicyChanges({
    fromAssets: collectSecurityPolicyAssetEvidence(fromInputs),
    toAssets: collectSecurityPolicyAssetEvidence(toInputs),
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });

  const skill = result.policyChanges.find(
    (change) => change.asset.id === "skill.demo",
  );
  const script = result.policyChanges.find(
    (change) => change.asset.id === "script.demo.run",
  );
  assert.equal(skill?.fields[0]?.provenance.mode, "direct");
  assert.deepEqual(script?.fields[0]?.provenance, {
    mode: "inherited",
    sources: [{ type: "owning_skill", id: "skill.demo", path: skillPath }],
  });
});

test("declaration reordering and duplicate values produce no semantic change", () => {
  const path = "contexts/reordered.md";
  const fromAssets = collectSecurityPolicyAssetEvidence([
    artifact(
      path,
      "context",
      policy({
        allowedData: ["public", "internal"],
        approvedNetworkDestinations: ["a.example.com", "b.example.com"],
      }),
    ),
  ]);
  const toAssets = collectSecurityPolicyAssetEvidence([
    artifact(
      path,
      "context",
      policy({
        allowedData: ["internal", "public", "internal"],
        approvedNetworkDestinations: [
          "b.example.com",
          "a.example.com",
          "a.example.com",
        ],
      }),
    ),
  ]);

  assert.deepEqual(buildSecurityPolicyChanges({ fromAssets, toAssets }), {
    policyChanges: [],
    sharedPolicyChanges: [],
  });
});

test("duplicate asset IDs retain every path in shared-policy blast radius", () => {
  const inputs = [
    artifact(
      "contexts/one.md",
      "context",
      policy({ securityProfile: "shared" }),
    ),
    artifact(
      "contexts/two.md",
      "context",
      policy({ securityProfile: "shared" }),
    ),
  ];
  const fromConfig = securityConfig({
    profiles: { shared: profile({ networkAllowed: false }) },
  });
  const toConfig = securityConfig({
    profiles: { shared: profile({ networkAllowed: true }) },
  });
  const duplicateIds = new Map([
    ["contexts/one.md", "context.duplicate"],
    ["contexts/two.md", "context.duplicate"],
  ]);

  const result = buildSecurityPolicyChanges({
    fromAssets: collectSecurityPolicyAssetEvidence(inputs, fromConfig),
    toAssets: collectSecurityPolicyAssetEvidence(inputs, toConfig),
    fromConfig,
    toConfig,
    fromAssetIdsByPath: duplicateIds,
    toAssetIdsByPath: duplicateIds,
  });

  assert.deepEqual(
    result.policyChanges.map(({ asset }) => [asset.id, asset.path]),
    [
      ["context.duplicate", "contexts/one.md"],
      ["context.duplicate", "contexts/two.md"],
    ],
  );
  assert.equal(result.sharedPolicyChanges[0]?.affectedAssets.length, 2);
});

interface PolicyInput {
  securityProfile?: string;
  allowedData?: string[];
  forbiddenInputs?: string[];
  networkAllowed?: boolean;
  externalUploadAllowed?: boolean;
  secretsAllowed?: boolean;
  humanApprovalRequired?: boolean;
  approvedNetworkDestinations?: string[];
  approvedUploadDestinations?: string[];
}

function policy(input: PolicyInput): string {
  const lines = ["---"];
  if (input.securityProfile !== undefined)
    lines.push(`security_profile: ${input.securityProfile}`);
  appendList(lines, "allowed_data", input.allowedData);
  appendList(lines, "forbidden_inputs", input.forbiddenInputs);
  appendBoolean(lines, "network_allowed", input.networkAllowed);
  appendBoolean(lines, "external_upload_allowed", input.externalUploadAllowed);
  appendBoolean(lines, "secrets_allowed", input.secretsAllowed);
  appendBoolean(lines, "requires_human_approval", input.humanApprovalRequired);
  appendList(
    lines,
    "approved_network_destinations",
    input.approvedNetworkDestinations,
  );
  appendList(
    lines,
    "approved_upload_destinations",
    input.approvedUploadDestinations,
  );
  return [...lines, "---", "# Policy", ""].join("\n");
}

function skillPolicy(networkAllowed: boolean): string {
  return [
    "---",
    "name: demo",
    "description: Deterministic fixture Skill with reviewable security policy evidence.",
    "metadata:",
    `  renma.network-allowed: "${networkAllowed}"`,
    "---",
    "# Demo",
    "",
  ].join("\n");
}

function appendList(
  lines: string[],
  key: string,
  values: string[] | undefined,
): void {
  if (values === undefined) return;
  lines.push(`${key}:`);
  lines.push(...values.map((value) => `  - ${value}`));
}

function appendBoolean(
  lines: string[],
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) lines.push(`${key}: ${value}`);
}

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: path.endsWith(".md"),
    content,
  };
}

function securityConfig(input: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    approvedDomains: input.approvedDomains ?? [],
    approvedUploadDomains: input.approvedUploadDomains ?? [],
    disallowedCommands: input.disallowedCommands ?? [],
    ...(input.profiles ? { profiles: input.profiles } : {}),
  };
}

function profile(input: Partial<SecurityProfileConfig>): SecurityProfileConfig {
  return {
    allowedData: input.allowedData ?? [],
    forbiddenInputs: input.forbiddenInputs ?? [],
    approvedDomains: input.approvedDomains ?? [],
    approvedUploadDomains: input.approvedUploadDomains ?? [],
    disallowedCommands: input.disallowedCommands ?? [],
    ...(input.allowedDataClass !== undefined
      ? { allowedDataClass: input.allowedDataClass }
      : {}),
    ...(input.networkAllowed !== undefined
      ? { networkAllowed: input.networkAllowed }
      : {}),
    ...(input.externalUploadAllowed !== undefined
      ? { externalUploadAllowed: input.externalUploadAllowed }
      : {}),
    ...(input.secretsAllowed !== undefined
      ? { secretsAllowed: input.secretsAllowed }
      : {}),
    ...(input.humanApprovalRequired !== undefined
      ? { humanApprovalRequired: input.humanApprovalRequired }
      : {}),
    ...(input.securityProfile !== undefined
      ? { securityProfile: input.securityProfile }
      : {}),
  };
}
