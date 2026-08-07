import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

const PROFILE_ALIAS_GROUPS = [
  {
    field: "allowedDataClass",
    aliases: ["allowedDataClass", "allowed_data_class"],
    input: "restricted",
    normalized: "restricted",
  },
  {
    field: "networkAllowed",
    aliases: ["networkAllowed", "network_allowed"],
    input: false,
    normalized: false,
  },
  {
    field: "externalUploadAllowed",
    aliases: ["externalUploadAllowed", "external_upload_allowed"],
    input: false,
    normalized: false,
  },
  {
    field: "secretsAllowed",
    aliases: ["secretsAllowed", "secrets_allowed"],
    input: false,
    normalized: false,
  },
  {
    field: "humanApprovalRequired",
    aliases: [
      "humanApprovalRequired",
      "human_approval_required",
      "requiresHumanApproval",
      "requires_human_approval",
    ],
    input: true,
    normalized: true,
  },
  {
    field: "securityProfile",
    aliases: ["securityProfile", "security_profile"],
    input: "base",
    normalized: "base",
  },
  {
    field: "allowedData",
    aliases: ["allowedData", "allowed_data"],
    input: "repo-local-files",
    normalized: ["repo-local-files"],
  },
  {
    field: "forbiddenInputs",
    aliases: ["forbiddenInputs", "forbidden_inputs"],
    input: "secrets",
    normalized: ["secrets"],
  },
] as const;

const BOOLEAN_PROFILE_ALIAS_GROUPS = PROFILE_ALIAS_GROUPS.filter(
  (group) => typeof group.input === "boolean",
);

test("every security profile alias remains valid when used alone", async (t) => {
  for (const group of PROFILE_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      await t.test(`${group.field} via ${alias}`, async (caseContext) => {
        const root = await profileConfigFixture(caseContext, {
          [alias]: group.input,
        });

        const loaded = await loadConfig(root, {});
        const profile = loaded.config.security.profiles?.restricted;

        assert.deepEqual(
          profile?.[group.field],
          group.normalized,
          `${alias} did not normalize to ${group.field}`,
        );
      });
    }
  }
});

test("equivalent duplicate security profile aliases remain valid", async (t) => {
  const cases: Array<{
    name: string;
    field: string;
    profile: Record<string, unknown>;
    expected: unknown;
  }> = [
    ...BOOLEAN_PROFILE_ALIAS_GROUPS.map((group) => ({
      name: group.field,
      field: group.field,
      profile: Object.fromEntries(group.aliases.map((alias) => [alias, true])),
      expected: true,
    })),
    {
      name: "allowedDataClass",
      field: "allowedDataClass",
      profile: {
        allowedDataClass: "restricted",
        allowed_data_class: "restricted",
      },
      expected: "restricted",
    },
    {
      name: "securityProfile",
      field: "securityProfile",
      profile: { securityProfile: "base", security_profile: "base" },
      expected: "base",
    },
    {
      name: "allowedData scalar and one-item list",
      field: "allowedData",
      profile: {
        allowedData: "repo-local-files",
        allowed_data: ["repo-local-files"],
      },
      expected: ["repo-local-files"],
    },
    {
      name: "allowedData duplicate entries preserve first-occurrence order",
      field: "allowedData",
      profile: {
        allowedData: ["repo-local-files", "repo-local-files", "public-docs"],
        allowed_data: ["repo-local-files", "public-docs"],
      },
      expected: ["repo-local-files", "repo-local-files", "public-docs"],
    },
    {
      name: "forbiddenInputs set equality",
      field: "forbiddenInputs",
      profile: {
        forbiddenInputs: ["secrets", "tokens", "secrets"],
        forbidden_inputs: ["tokens", "secrets"],
      },
      expected: ["secrets", "tokens", "secrets"],
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async (caseContext) => {
      const root = await profileConfigFixture(caseContext, item.profile);
      const loaded = await loadConfig(root, {});
      const profile = loaded.config.security.profiles?.restricted;
      assert.deepEqual(
        (profile as unknown as Record<string, unknown> | undefined)?.[
          item.field
        ],
        item.expected,
      );
    });
  }
});

test("conflicting boolean aliases are rejected in both directions", async (t) => {
  for (const group of BOOLEAN_PROFILE_ALIAS_GROUPS) {
    for (let leftIndex = 0; leftIndex < group.aliases.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < group.aliases.length;
        rightIndex += 1
      ) {
        const leftAlias = group.aliases[leftIndex];
        const rightAlias = group.aliases[rightIndex];
        if (leftAlias === undefined || rightAlias === undefined) continue;
        for (const [left, right] of [
          [false, true],
          [true, false],
        ] as const) {
          await t.test(
            `${group.field}: ${leftAlias}=${left}, ${rightAlias}=${right}`,
            async (caseContext) => {
              const root = await profileConfigFixture(caseContext, {
                [leftAlias]: left,
                [rightAlias]: right,
              });
              await assertAliasConflict(root, group.field, [
                leftAlias,
                rightAlias,
              ]);
            },
          );
        }
      }
    }
  }

  await t.test(
    "humanApprovalRequired detects one conflict across all four aliases",
    async (caseContext) => {
      const aliases = [
        "humanApprovalRequired",
        "human_approval_required",
        "requiresHumanApproval",
        "requires_human_approval",
      ];
      const root = await profileConfigFixture(caseContext, {
        humanApprovalRequired: true,
        human_approval_required: true,
        requiresHumanApproval: true,
        requires_human_approval: false,
      });
      await assertAliasConflict(root, "humanApprovalRequired", aliases);
    },
  );
});

test("conflicting string and list aliases are rejected", async (t) => {
  const cases = [
    {
      field: "allowedDataClass",
      aliases: ["allowedDataClass", "allowed_data_class"],
      values: ["restricted", "public"],
    },
    {
      field: "securityProfile",
      aliases: ["securityProfile", "security_profile"],
      values: ["base", "permissive"],
    },
    {
      field: "allowedData",
      aliases: ["allowedData", "allowed_data"],
      values: [["repo-local-files"], ["public-docs"]],
    },
    {
      field: "allowedData",
      aliases: ["allowedData", "allowed_data"],
      values: [
        ["disclosed", "public-docs"],
        ["public-docs", "disclosed"],
      ],
    },
    {
      field: "forbiddenInputs",
      aliases: ["forbiddenInputs", "forbidden_inputs"],
      values: [["secrets"], ["tokens"]],
    },
  ] as const;

  for (const item of cases) {
    for (const [left, right] of [
      item.values,
      [item.values[1], item.values[0]],
    ]) {
      await t.test(
        `${item.field}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`,
        async (caseContext) => {
          const root = await profileConfigFixture(caseContext, {
            [item.aliases[0]]: left,
            [item.aliases[1]]: right,
          });
          await assertAliasConflict(root, item.field, [...item.aliases]);
        },
      );
    }
  }
});

test("every explicitly present alias is type-validated", async (t) => {
  const cases = PROFILE_ALIAS_GROUPS.map((group) => ({
    field: group.field,
    validAlias: group.aliases[0],
    invalidAlias: group.aliases.at(-1),
    valid: group.input,
    invalid:
      typeof group.input === "boolean"
        ? "false"
        : typeof group.input === "string" &&
            group.field !== "allowedData" &&
            group.field !== "forbiddenInputs"
          ? false
          : 42,
    expectedType:
      typeof group.input === "boolean"
        ? "a boolean"
        : typeof group.input === "string" &&
            group.field !== "allowedData" &&
            group.field !== "forbiddenInputs"
          ? "a string"
          : "an array of strings",
  }));

  for (const item of cases) {
    await t.test(item.field, async (caseContext) => {
      assert.ok(item.validAlias);
      assert.ok(item.invalidAlias);
      const root = await profileConfigFixture(caseContext, {
        [item.validAlias]: item.valid,
        [item.invalidAlias]: item.invalid,
      });
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.message.includes(
            `security.profiles.restricted.${item.invalidAlias} must be ${item.expectedType}`,
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

async function assertAliasConflict(
  root: string,
  field: string,
  aliases: string[],
): Promise<void> {
  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message.includes("security.profiles.restricted") &&
      error.message.includes(`conflicting aliases for ${field}`) &&
      aliases.every((alias) => error.message.includes(`${alias}=`)) &&
      error.message.includes(
        "Use only one spelling or make all aliases equivalent",
      ),
  );
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
