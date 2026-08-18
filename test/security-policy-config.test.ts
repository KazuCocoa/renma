import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

const CANONICAL_PROFILE_FIELDS = [
  {
    field: "allowedDataClass",
    key: "allowed_data_class",
    input: "restricted",
    normalized: "restricted",
  },
  {
    field: "networkAllowed",
    key: "network_allowed",
    input: false,
    normalized: false,
  },
  {
    field: "externalUploadAllowed",
    key: "external_upload_allowed",
    input: false,
    normalized: false,
  },
  {
    field: "secretsAllowed",
    key: "secrets_allowed",
    input: false,
    normalized: false,
  },
  {
    field: "humanApprovalRequired",
    key: "requires_human_approval",
    input: true,
    normalized: true,
  },
  {
    field: "securityProfile",
    key: "security_profile",
    input: "base",
    normalized: "base",
  },
  {
    field: "allowedData",
    key: "allowed_data",
    input: "repo-local-files",
    normalized: ["repo-local-files"],
  },
  {
    field: "forbiddenInputs",
    key: "forbidden_inputs",
    input: "secrets",
    normalized: ["secrets"],
  },
  {
    field: "approvedDomains",
    key: "approvedDomains",
    input: ["example.com"],
    normalized: ["example.com"],
  },
  {
    field: "approvedUploadDomains",
    key: "approvedUploadDomains",
    input: ["uploads.example.com"],
    normalized: ["uploads.example.com"],
  },
  {
    field: "disallowedCommands",
    key: "disallowedCommands",
    input: ["curl"],
    normalized: ["curl"],
  },
] as const;

test("every canonical v1 security profile property has one accepted spelling", async (t) => {
  for (const item of CANONICAL_PROFILE_FIELDS) {
    await t.test(item.key, async (caseContext) => {
      const root = await profileConfigFixture(caseContext, {
        [item.key]: item.input,
      });
      const loaded = await loadConfig(root, {});
      const profile = loaded.config.security.profiles?.restricted;
      assert.deepEqual(
        (profile as unknown as Record<string, unknown> | undefined)?.[
          item.field
        ],
        item.normalized,
      );
    });
  }
});

test("historical security profile spellings fail with canonical replacements", async (t) => {
  const historical = [
    ["allowedDataClass", "allowed_data_class"],
    ["networkAllowed", "network_allowed"],
    ["externalUploadAllowed", "external_upload_allowed"],
    ["secretsAllowed", "secrets_allowed"],
    ["humanApprovalRequired", "requires_human_approval"],
    ["human_approval_required", "requires_human_approval"],
    ["requiresHumanApproval", "requires_human_approval"],
    ["securityProfile", "security_profile"],
    ["allowedData", "allowed_data"],
    ["forbiddenInputs", "forbidden_inputs"],
  ] as const;
  for (const [legacy, canonical] of historical) {
    await t.test(legacy, async (caseContext) => {
      const root = await profileConfigFixture(caseContext, { [legacy]: false });
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.message.startsWith(unsupportedKeyHeader(root)) &&
          error.message.includes(
            `- ${JSON.stringify(legacy)} -> use ${JSON.stringify(canonical)} (historical)`,
          ),
      );
    });
  }
});

test("multiple historical security profile keys produce one actionable error", async (t) => {
  const root = await configFixture(t, {
    security: {
      profiles: {
        "appium-local-workflows": {
          networkAllowed: false,
          humanApprovalRequired: true,
          allowedData: ["repo-local-files"],
        },
      },
    },
  });

  const error = await configError(root);
  assert.equal(
    error.message,
    `${unsupportedKeyHeader(root)}

security.profiles.appium-local-workflows:
- "allowedData" -> use "allowed_data" (historical)
- "humanApprovalRequired" -> use "requires_human_approval" (historical)
- "networkAllowed" -> use "network_allowed" (historical)

Renma v1 does not interpret these historical configuration keys. Update every listed key and rerun \`renma scan .\`.`,
  );
});

test("layout and historical aliases aggregate across profiles in stable order", async (t) => {
  const firstRoot = await configFixture(t, {
    fail_on: "high",
    layout: { tool_namespace: "appium" },
    security: {
      profiles: {
        "appium-local-workflows": {
          allowedData: ["repo-local-files"],
          externalUploadAllowed: false,
          secretsAllowed: false,
        },
        "appium-real-device-workflows": {
          allowedData: ["repo-local-files"],
          networkAllowed: true,
          externalUploadAllowed: false,
        },
      },
    },
  });
  const secondRoot = await configFixture(t, {
    security: {
      profiles: {
        "appium-real-device-workflows": {
          externalUploadAllowed: false,
          networkAllowed: true,
          allowedData: ["repo-local-files"],
        },
        "appium-local-workflows": {
          secretsAllowed: false,
          externalUploadAllowed: false,
          allowedData: ["repo-local-files"],
        },
      },
    },
    layout: { tool_namespace: "appium" },
    fail_on: "high",
  });

  const firstError = await configError(firstRoot);
  const secondError = await configError(secondRoot);
  const expectedBody = `

Top-level configuration:
- "layout" -> remove this field; there is no replacement (removed)

security.profiles.appium-local-workflows:
- "allowedData" -> use "allowed_data" (historical)
- "externalUploadAllowed" -> use "external_upload_allowed" (historical)
- "secretsAllowed" -> use "secrets_allowed" (historical)

security.profiles.appium-real-device-workflows:
- "allowedData" -> use "allowed_data" (historical)
- "externalUploadAllowed" -> use "external_upload_allowed" (historical)
- "networkAllowed" -> use "network_allowed" (historical)

Renma v1 does not interpret these removed or historical configuration keys. Apply every listed replacement and remove every listed key without one and rerun \`renma scan .\`.`;
  assert.equal(
    firstError.message,
    `${unsupportedKeyHeader(firstRoot)}${expectedBody}`,
  );
  assert.equal(
    secondError.message,
    `${unsupportedKeyHeader(secondRoot)}${expectedBody}`,
  );
});

test("removed historical and unknown keys remain visibly distinct", async (t) => {
  const root = await configFixture(t, {
    mysteryTop: true,
    layout: {},
    security: {
      mysterySecurity: true,
      profiles: {
        restricted: {
          totallyUnknownField: true,
          allowedData: ["repo-local-files"],
        },
      },
    },
  });

  const error = await configError(root);
  assert.equal(
    error.message,
    `${unsupportedKeyHeader(root)}

Top-level configuration:
- "layout" -> remove this field; there is no replacement (removed)
- "mysteryTop" (unknown)

security:
- "mysterySecurity" (unknown)

security.profiles.restricted:
- "allowedData" -> use "allowed_data" (historical)
- "totallyUnknownField" (unknown)

Allowed top-level keys: concurrency, exclude, executable_surface, fail_on, format, globs, max_depth, max_file_size_bytes, metadata, quality, scan_boundary, security, skill_discovery, suppressions.

Allowed security keys: approvedDomains, approvedUploadDomains, ci_policy, disallowedCommands, profiles.

Allowed security profile keys: allowed_data, allowed_data_class, approvedDomains, approvedUploadDomains, disallowedCommands, external_upload_allowed, forbidden_inputs, network_allowed, requires_human_approval, secrets_allowed, security_profile.

Renma v1 does not interpret these removed, historical, or unknown configuration keys. Apply every listed replacement and remove every listed key without one and rerun \`renma scan .\`.`,
  );
});

test("unknown configuration keys aggregate across every inspectable scope", async (t) => {
  const root = await configFixture(t, {
    zTopUnknown: true,
    aTopUnknown: true,
    security: {
      zSecurityUnknown: true,
      aSecurityUnknown: true,
      profiles: {
        "z-profile": { zUnknown: true },
        "a-profile": { zUnknown: true, aUnknown: true },
      },
    },
  });

  const error = await configError(root);
  assert.equal(
    error.message,
    `${unsupportedKeyHeader(root)}

Top-level configuration:
- "aTopUnknown" (unknown)
- "zTopUnknown" (unknown)

security:
- "aSecurityUnknown" (unknown)
- "zSecurityUnknown" (unknown)

security.profiles.a-profile:
- "aUnknown" (unknown)
- "zUnknown" (unknown)

security.profiles.z-profile:
- "zUnknown" (unknown)

Allowed top-level keys: concurrency, exclude, executable_surface, fail_on, format, globs, max_depth, max_file_size_bytes, metadata, quality, scan_boundary, security, skill_discovery, suppressions.

Allowed security keys: approvedDomains, approvedUploadDomains, ci_policy, disallowedCommands, profiles.

Allowed security profile keys: allowed_data, allowed_data_class, approvedDomains, approvedUploadDomains, disallowedCommands, external_upload_allowed, forbidden_inputs, network_allowed, requires_human_approval, secrets_allowed, security_profile.

Renma v1 does not interpret these unknown configuration keys. Remove every listed key and rerun \`renma scan .\`.`,
  );
});

test("malformed configuration containers retain strict structural errors", async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["top-level array", [], /Config.*must be a JSON object/],
    ["security null", { security: null }, /security must be an object/],
    ["security array", { security: [] }, /security must be an object/],
    [
      "profiles scalar",
      { security: { profiles: "restricted" } },
      /security\.profiles must be an object/,
    ],
    [
      "profile array",
      { security: { profiles: { restricted: [] } } },
      /security\.profiles\.restricted must be an object/,
    ],
  ];

  for (const [name, config, expected] of cases) {
    await t.test(name, async (caseContext) => {
      const root = await configFixture(caseContext, config);
      await assert.rejects(loadConfig(root, {}), expected);
    });
  }
});

test("canonical security profile values remain strictly typed", async (t) => {
  for (const [key, value, expected] of [
    ["network_allowed", "false", "a boolean"],
    ["allowed_data_class", false, "a string"],
    ["allowed_data", 42, "an array of strings"],
  ] as const) {
    await t.test(key, async (caseContext) => {
      const root = await profileConfigFixture(caseContext, { [key]: value });
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.message.includes(
            `security.profiles.restricted.${key} must be ${expected}`,
          ),
      );
    });
  }
});

test("security CI policy defaults to fail", async (t) => {
  const root = await configFixture(t);
  const loaded = await loadConfig(root, {});

  assert.equal(loaded.config.security.ciPolicy, "fail");
});

test("security CI policy accepts off warn and fail", async (t) => {
  for (const mode of ["off", "warn", "fail"] as const) {
    await t.test(mode, async (caseContext) => {
      const root = await configFixture(caseContext, {
        security: { ci_policy: mode },
      });
      const loaded = await loadConfig(root, {});
      assert.equal(loaded.config.security.ciPolicy, mode);
    });
  }
});

test("security CI policy validation is strict and actionable", async (t) => {
  const cases: Array<[unknown, RegExp]> = [
    [
      { security: { ci_policy: true } },
      /security\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { security: { ci_policy: "block" } },
      /security\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { security: { unknown: true } },
      /security:[\s\S]*"unknown" \(unknown\)[\s\S]*Allowed security keys:.*ci_policy/,
    ],
  ];

  for (const [config, expected] of cases) {
    await t.test(JSON.stringify(config), async (caseContext) => {
      const root = await configFixture(caseContext, config);
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError && expected.test(error.message),
      );
    });
  }
});

test("snapshot security CI policy config is immutable", async (t) => {
  const root = await configFixture(t, {
    security: { ci_policy: "warn" },
  });
  const snapshot = await collectRepositorySnapshot(root);

  assert.equal(snapshot.config.security.ciPolicy, "warn");
  assert.throws(() => {
    snapshot.config.security.ciPolicy = "off";
  }, TypeError);
});

async function profileConfigFixture(
  t: test.TestContext,
  profile: Record<string, unknown>,
): Promise<string> {
  return configFixture(t, {
    security: {
      profiles: {
        restricted: profile,
      },
    },
  });
}

async function configFixture(
  t: test.TestContext,
  config?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-security-ci-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  if (config !== undefined) {
    await writeFile(
      join(root, "renma.config.json"),
      `${JSON.stringify(config)}\n`,
    );
  }
  return root;
}

async function configError(root: string): Promise<ConfigError> {
  try {
    await loadConfig(root, {});
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error;
  }
  assert.fail("Expected loadConfig to reject invalid security profile keys.");
}

function unsupportedKeyHeader(root: string): string {
  return `Unsupported configuration keys found in ${join(root, "renma.config.json")}:`;
}
