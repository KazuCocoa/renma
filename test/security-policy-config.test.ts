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
          error.message.includes(
            `Historical security profile key "${legacy}"`,
          ) &&
          error.message.includes(`Use "${canonical}" instead`),
      );
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
      /Unknown security config key "unknown".*ci_policy/,
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
