import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ConfigError,
  loadConfig,
  type ConfigOverrides,
} from "../src/config.js";

test("multiple unknown quality keys produce one sorted aggregate", async (t) => {
  const root = await configFixture(t, {
    quality: {
      wrongQualityKey: 1,
      anotherWrongQualityKey: 2,
    },
  });

  const error = await configError(root);
  assert.equal(
    error.message.match(/Unsupported configuration keys found in /gu)?.length,
    1,
  );
  assert.equal(
    error.message.split("\n", 1)[0],
    `Unsupported configuration keys found in ${path.join(root, "renma.config.json")}:`,
  );
  assertOrderedSubstrings(error.message, [
    "quality:",
    '- "anotherWrongQualityKey" (unknown)',
    '- "wrongQualityKey" (unknown)',
    "Allowed quality keys:",
  ]);
});

test("all inspectable config scopes aggregate independently of author order", async (t) => {
  const firstRoot = await configFixture(t, invalidConfigInFirstOrder());
  const secondRoot = await configFixture(t, invalidConfigInSecondOrder());

  const firstError = await configError(firstRoot);
  const secondError = await configError(secondRoot);
  assert.equal(
    aggregateBody(firstError.message),
    aggregateBody(secondError.message),
  );
  assert.equal(
    firstError.message.split("\n", 1)[0],
    `Unsupported configuration keys found in ${path.join(firstRoot, "renma.config.json")}:`,
  );
  assert.equal(
    secondError.message.split("\n", 1)[0],
    `Unsupported configuration keys found in ${path.join(secondRoot, "renma.config.json")}:`,
  );
  assertOrderedSubstrings(firstError.message, [
    "Top-level configuration:",
    '- "layout" -> remove this field; there is no replacement (removed)',
    '- "mysteryTop" (unknown)',
    "quality:",
    '- "anotherWrongQualityKey" (unknown)',
    '- "wrongQualityKey" (unknown)',
    "metadata:",
    '- "legacyRequiredFields" (unknown)',
    '- "unexpected" (unknown)',
    "diagnostics:",
    '- "diagnosticUnexpected" (unknown)',
    "suppressions[0]:",
    '- "aSuppressionKey" (unknown)',
    '- "zSuppressionKey" (unknown)',
    "scan_boundary:",
    '- "foo" (unknown)',
    "executable_surface:",
    '- "bar" (unknown)',
    "security:",
    '- "mysterySecurity" (unknown)',
    "security.profiles.appium-local-workflows:",
    '- "allowedData" -> use "allowed_data" (historical)',
    '- "networkAllowed" -> use "network_allowed" (historical)',
    '- "totallyUnknownField" (unknown)',
    "security.profiles.release:",
    '- "forbiddenInputs" -> use "forbidden_inputs" (historical)',
    "skill_discovery:",
    '- "enabled" (unknown)',
    '- "mystery" (unknown)',
    "Allowed top-level keys:",
    "Allowed quality keys:",
    "Allowed metadata keys:",
    "Allowed diagnostics keys:",
    "Allowed suppression keys:",
    "Allowed scan_boundary keys:",
    "Allowed executable_surface keys:",
    "Allowed security keys:",
    "Allowed security profile keys:",
    "Allowed skill_discovery keys:",
    "Renma v1 does not interpret these removed, historical, or unknown configuration keys.",
  ]);
});

test("explicit config path identifies the exact unsupported-key source", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "renma-config-keys-explicit-"),
  );
  t.after(() => rm(root, { force: true, recursive: true }));
  const configPath = path.join(root, "review-policy.jsonc");
  await writeFile(
    configPath,
    `{
  // Explicit review configuration.
  "quality": { "wrongQualityKey": 1, "anotherWrongQualityKey": 2 }
}\n`,
  );

  const error = await configError(root, { configPath });
  assert.equal(
    error.message.split("\n", 1)[0],
    `Unsupported configuration keys found in ${configPath}:`,
  );
  assertOrderedSubstrings(error.message, [
    "quality:",
    '- "anotherWrongQualityKey" (unknown)',
    '- "wrongQualityKey" (unknown)',
  ]);
});

test("malformed nested containers fail before unsupported-key collection", async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["quality", { mysteryTop: true, quality: [] }, /quality must be an object/],
    [
      "metadata",
      { mysteryTop: true, metadata: null },
      /metadata must be an object/,
    ],
    [
      "diagnostics",
      { mysteryTop: true, diagnostics: [] },
      /diagnostics must be an object/,
    ],
    [
      "diagnostic severity",
      { mysteryTop: true, diagnostics: { severity: [] } },
      /diagnostics\.severity must be an object/,
    ],
    [
      "suppressions",
      { mysteryTop: true, suppressions: {} },
      /suppressions must be an array/,
    ],
    [
      "suppression entry",
      { mysteryTop: true, suppressions: [[]] },
      /suppressions\[0\] must be an object/,
    ],
    [
      "scan boundary",
      { mysteryTop: true, scan_boundary: "bad" },
      /scan_boundary must be an object/,
    ],
    [
      "executable surface",
      { mysteryTop: true, executable_surface: false },
      /executable_surface must be an object/,
    ],
    [
      "security profile",
      {
        mysteryTop: true,
        security: { profiles: { restricted: [] } },
      },
      /security\.profiles\.restricted must be an object/,
    ],
    [
      "skill discovery",
      { mysteryTop: true, skill_discovery: [] },
      /skill_discovery must be an object/,
    ],
  ];

  for (const [name, config, expected] of cases) {
    await t.test(name, async (caseContext) => {
      const root = await configFixture(caseContext, config);
      const error = await configError(root);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /Unsupported configuration keys/);
    });
  }
});

test("representative canonical keys in every config scope continue to load", async (t) => {
  const root = await configFixture(t, {
    fail_on: "medium",
    format: "json",
    globs: ["**/*.md"],
    exclude: ["dist"],
    max_file_size_bytes: 1024,
    max_depth: 8,
    concurrency: 2,
    suppressions: [
      {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Reviewed fixture.",
        expires: "never",
      },
    ],
    scan_boundary: { ci_policy: "warn" },
    executable_surface: { ci_policy: "warn" },
    quality: {
      ci_policy: "warn",
      skill_token_warning: 5000,
      skill_token_high: 8000,
      context_token_warning: 1000,
      context_token_high: 2000,
      reference_token_warning: 1000,
      reference_token_high: 2000,
      profile_token_warning: 1000,
      profile_token_high: 2000,
      example_token_warning: 1000,
      example_token_high: 2000,
    },
    metadata: { ci_policy: "warn", required: [] },
    diagnostics: {
      ci_policy: "warn",
      severity: { "META-REQUIRED-SUSPENDED-DEPENDENCY": "high" },
    },
    security: {
      approvedDomains: ["example.com"],
      approvedUploadDomains: ["uploads.example.com"],
      disallowedCommands: ["curl"],
      ci_policy: "warn",
      profiles: {
        restricted: {
          allowed_data_class: "restricted",
          network_allowed: false,
          external_upload_allowed: false,
          secrets_allowed: false,
          requires_human_approval: true,
          security_profile: "base",
          allowed_data: ["repo-local-files"],
          forbidden_inputs: ["secrets"],
          approvedDomains: ["example.com"],
          approvedUploadDomains: ["uploads.example.com"],
          disallowedCommands: ["curl"],
        },
      },
    },
    skill_discovery: { adopted: true, ci_policy: "warn" },
  });

  const loaded = await loadConfig(root, {});
  assert.equal(loaded.config.failOn, "medium");
  assert.equal(loaded.config.quality.ciPolicy, "warn");
  assert.deepEqual(loaded.config.metadata.required, []);
  assert.equal(loaded.config.diagnostics.ciPolicy, "warn");
  assert.equal(
    loaded.config.diagnostics.severity["META-REQUIRED-SUSPENDED-DEPENDENCY"],
    "high",
  );
  assert.equal(loaded.config.scanBoundary.ciPolicy, "warn");
  assert.equal(loaded.config.executableSurface.ciPolicy, "warn");
  assert.equal(
    loaded.config.security.profiles?.restricted?.networkAllowed,
    false,
  );
  assert.equal(loaded.config.skillDiscovery.ciPolicy, "warn");
  assert.equal(loaded.config.suppressions[0]?.expires, "never");
});

test("semantic validation remains separate after key preflight", async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    [
      "quality thresholds",
      { quality: { skill_token_warning: 9000, skill_token_high: 8000 } },
      /skill_token_warning \(9000\) must be strictly lower/,
    ],
    [
      "metadata required field",
      { metadata: { required: ["id"] } },
      /Unsupported metadata\.required field "id"/,
    ],
    [
      "security profile boolean",
      { security: { profiles: { restricted: { network_allowed: "false" } } } },
      /security\.profiles\.restricted\.network_allowed must be a boolean/,
    ],
    [
      "skill discovery policy",
      { skill_discovery: { adopted: false, ci_policy: "warn" } },
      /ci_policy "warn" requires skill_discovery\.adopted to be true/,
    ],
  ];

  for (const [name, config, expected] of cases) {
    await t.test(name, async (caseContext) => {
      const root = await configFixture(caseContext, config);
      const error = await configError(root);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /Unsupported configuration keys/);
    });
  }
});

function invalidConfigInFirstOrder(): Record<string, unknown> {
  return {
    skill_discovery: { mystery: true, enabled: true },
    security: {
      mysterySecurity: true,
      profiles: {
        release: { forbiddenInputs: ["secrets"] },
        "appium-local-workflows": {
          totallyUnknownField: true,
          networkAllowed: false,
          allowedData: ["repo-local-files"],
        },
      },
    },
    executable_surface: { bar: true },
    scan_boundary: { foo: true },
    suppressions: [
      {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Reviewed fixture.",
        zSuppressionKey: true,
        aSuppressionKey: true,
      },
    ],
    metadata: { unexpected: true, legacyRequiredFields: [] },
    diagnostics: { diagnosticUnexpected: true },
    quality: { wrongQualityKey: 1, anotherWrongQualityKey: 2 },
    mysteryTop: true,
    layout: {},
  };
}

function invalidConfigInSecondOrder(): Record<string, unknown> {
  return {
    layout: {},
    mysteryTop: true,
    quality: { anotherWrongQualityKey: 2, wrongQualityKey: 1 },
    metadata: { legacyRequiredFields: [], unexpected: true },
    diagnostics: { diagnosticUnexpected: true },
    suppressions: [
      {
        aSuppressionKey: true,
        zSuppressionKey: true,
        reason: "Reviewed fixture.",
        paths: ["skills/demo/**"],
        id: "SEC-LITERAL-SECRET",
      },
    ],
    scan_boundary: { foo: true },
    executable_surface: { bar: true },
    security: {
      profiles: {
        "appium-local-workflows": {
          allowedData: ["repo-local-files"],
          networkAllowed: false,
          totallyUnknownField: true,
        },
        release: { forbiddenInputs: ["secrets"] },
      },
      mysterySecurity: true,
    },
    skill_discovery: { enabled: true, mystery: true },
  };
}

function assertOrderedSubstrings(message: string, substrings: string[]): void {
  let previousIndex = -1;
  for (const substring of substrings) {
    const index = message.indexOf(substring);
    assert.ok(
      index > previousIndex,
      `Expected ${JSON.stringify(substring)} after index ${previousIndex}.`,
    );
    previousIndex = index;
  }
}

function aggregateBody(message: string): string {
  return message.slice(message.indexOf("\n"));
}

async function configFixture(
  t: test.TestContext,
  config: unknown,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "renma-config-keys-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify(config)}\n`,
  );
  return root;
}

async function configError(
  root: string,
  overrides: ConfigOverrides = {},
): Promise<ConfigError> {
  try {
    await loadConfig(root, overrides);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error;
  }
  assert.fail("Expected invalid configuration to throw ConfigError.");
}
