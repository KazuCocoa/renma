import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { ConfigError, DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { DEFAULT_QUALITY_PROFILE } from "../src/quality-profile.js";

const DEFAULT_CONTENT_TOKEN_BUDGETS = {
  context: {
    warning: 6400,
    high: 8000,
    warningSource: "renma_default",
    highSource: "renma_default",
  },
  reference: {
    warning: 7200,
    high: 9000,
    warningSource: "renma_default",
    highSource: "renma_default",
  },
  profile: {
    warning: 3200,
    high: 4000,
    warningSource: "renma_default",
    highSource: "renma_default",
  },
  example: {
    warning: 4800,
    high: 6000,
    warningSource: "renma_default",
    highSource: "renma_default",
  },
} as const;

test("quality token thresholds use Renma defaults when configuration is absent", async (t) => {
  const root = await fixture(t);

  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.quality, {
    ciPolicy: "fail",
    skillTokenWarning: 6400,
    skillTokenHigh: 8000,
    skillTokenWarningSource: "renma_default",
    skillTokenHighSource: "renma_default",
    contentTokenBudgets: DEFAULT_CONTENT_TOKEN_BUDGETS,
  });
});

test("loaded default quality policy is request-local", async (t) => {
  const root = await fixture(t);
  const loaded = await loadConfig(root, {});

  loaded.config.quality.skillTokenWarning = 1;
  loaded.config.quality.contentTokenBudgets.context.warning = 1;

  assert.equal(DEFAULT_CONFIG.quality.skillTokenWarning, 6400);
  assert.equal(
    DEFAULT_CONFIG.quality.contentTokenBudgets.context.warning,
    6400,
  );
  assert.equal(DEFAULT_QUALITY_PROFILE.skillTokenWarning, 6400);
  assert.equal(DEFAULT_QUALITY_PROFILE.contentTokenWarning.context, 6400);
  assert.equal(
    (await loadConfig(root, {})).config.quality.skillTokenWarning,
    6400,
  );
  assert.equal(
    (await loadConfig(root, {})).config.quality.contentTokenBudgets.context
      .warning,
    6400,
  );
});

test("quality token thresholds fall back independently and retain their sources", async (t) => {
  const cases = [
    {
      source: '{"quality":{"skill_token_warning":4000}}',
      expected: {
        ciPolicy: "fail",
        skillTokenWarning: 4000,
        skillTokenHigh: 8000,
        skillTokenWarningSource: "repository_configuration",
        skillTokenHighSource: "renma_default",
        contentTokenBudgets: DEFAULT_CONTENT_TOKEN_BUDGETS,
      },
    },
    {
      source: '{"quality":{"skill_token_high":9000}}',
      expected: {
        ciPolicy: "fail",
        skillTokenWarning: 6400,
        skillTokenHigh: 9000,
        skillTokenWarningSource: "renma_default",
        skillTokenHighSource: "repository_configuration",
        contentTokenBudgets: DEFAULT_CONTENT_TOKEN_BUDGETS,
      },
    },
  ] as const;

  for (const [index, config] of cases.entries()) {
    await t.test(String(index), async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(path.join(root, "renma.config.jsonc"), config.source);

      const loaded = await loadConfig(root, {});

      assert.deepEqual(loaded.config.quality, config.expected);
    });
  }
});

test("content token thresholds configure independently by asset kind", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    `{
  "quality": {
    "context_token_warning": 4500,
    "reference_token_high": 12000
  }
}`,
  );

  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.quality.contentTokenBudgets.context, {
    warning: 4500,
    high: 8000,
    warningSource: "repository_configuration",
    highSource: "renma_default",
  });
  assert.deepEqual(loaded.config.quality.contentTokenBudgets.reference, {
    warning: 7200,
    high: 12000,
    warningSource: "renma_default",
    highSource: "repository_configuration",
  });
  assert.deepEqual(
    loaded.config.quality.contentTokenBudgets.profile,
    DEFAULT_CONTENT_TOKEN_BUDGETS.profile,
  );
  assert.deepEqual(
    loaded.config.quality.contentTokenBudgets.example,
    DEFAULT_CONTENT_TOKEN_BUDGETS.example,
  );
});

test("content token thresholds reject invalid values and relationships", async (t) => {
  const fields = [
    "context_token_warning",
    "context_token_high",
    "reference_token_warning",
    "reference_token_high",
    "profile_token_warning",
    "profile_token_high",
    "example_token_warning",
    "example_token_high",
  ] as const;
  const invalidValues: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["string", "5000"],
    ["null", null],
    ["array", [5000]],
    ["object", { value: 5000 }],
  ];
  for (const field of fields) {
    for (const [label, value] of invalidValues) {
      await t.test(`${field} ${label}`, async (caseContext) => {
        const root = await fixture(caseContext);
        await writeFile(
          path.join(root, "renma.config.json"),
          JSON.stringify({ quality: { [field]: value } }),
        );
        await assert.rejects(
          loadConfig(root, {}),
          (error: unknown) =>
            error instanceof ConfigError &&
            error.message ===
              `quality.${field} must be a positive safe integer.`,
        );
      });
    }
  }

  for (const config of [
    {
      value: { context_token_warning: 8000 },
      message:
        "quality.context_token_warning (8000) must be strictly lower than quality.context_token_high (8000).",
    },
    {
      value: { reference_token_high: 5000 },
      message:
        "quality.reference_token_warning (7200) must be strictly lower than quality.reference_token_high (5000).",
    },
  ]) {
    await t.test(JSON.stringify(config.value), async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(
        path.join(root, "renma.config.jsonc"),
        JSON.stringify({ quality: config.value }),
      );
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError && error.message === config.message,
      );
    });
  }
});

test("automatically discovers and parses canonical JSONC comments", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    `{
  // Keep warning-only while existing repositories complete migration.
  "skill_discovery": {
    "adopted": true,
    /* Review warning quality before strengthening this policy. */
    "ci_policy": "warn"
  },
  "globs": [
    "https://example.com//context",
    "/* literal comment-like text */",
    "escaped \\\"quote\\\" and \\\\ backslash"
  ]
}
`,
  );

  const loaded = await loadConfig(root, {});

  assert.equal(loaded.configPath, "renma.config.jsonc");
  assert.deepEqual(loaded.config.skillDiscovery, {
    adopted: true,
    ciPolicy: "warn",
  });
  assert.deepEqual(loaded.config.globs, [
    "https://example.com//context",
    "/* literal comment-like text */",
    'escaped "quote" and \\ backslash',
  ]);
});

test("equivalent JSON and JSONC normalize to the same configuration", async (t) => {
  const jsonRoot = await fixture(t);
  const jsoncRoot = await fixture(t);
  const value = {
    fail_on: "critical",
    format: "json",
    max_depth: 8,
    quality: { skill_token_warning: 6000, skill_token_high: 9000 },
    skill_discovery: { adopted: true, ci_policy: "warn" },
  };
  await writeFile(
    path.join(jsonRoot, "renma.config.json"),
    `${JSON.stringify(value)}\n`,
  );
  await writeFile(
    path.join(jsoncRoot, "renma.config.jsonc"),
    `// Equivalent human-readable policy.\n${JSON.stringify(value)}\n`,
  );

  const json = await loadConfig(jsonRoot, {});
  const jsonc = await loadConfig(jsoncRoot, {});

  assert.deepEqual(json.config, jsonc.config);
  assert.equal(json.configPath, "renma.config.json");
  assert.equal(jsonc.configPath, "renma.config.jsonc");
  assert.deepEqual(json.config.quality, {
    ciPolicy: "fail",
    skillTokenWarning: 6000,
    skillTokenHigh: 9000,
    skillTokenWarningSource: "repository_configuration",
    skillTokenHighSource: "repository_configuration",
    contentTokenBudgets: DEFAULT_CONTENT_TOKEN_BUDGETS,
  });
});

test("rejects duplicate properties at every configuration object depth", async (t) => {
  const cases = [
    {
      name: "top-level conflicting values",
      file: "renma.config.json",
      source: '{\n  "format": "json",\n  "format": "text"\n}\n',
      path: "format",
      line: 3,
      column: 3,
    },
    {
      name: "nested identical values",
      file: "renma.config.json",
      source:
        '{\n  "security": {\n    "ci_policy": "fail",\n    "ci_policy": "fail"\n  }\n}\n',
      path: "security.ci_policy",
      line: 4,
      column: 5,
    },
    {
      name: "security profile",
      file: "renma.config.jsonc",
      source:
        '{\n  "security": {\n    "profiles": {\n      "restricted": {\n        "network_allowed": false,\n        "network_allowed": true\n      }\n    }\n  }\n}\n',
      path: "security.profiles.restricted.network_allowed",
      line: 6,
      column: 9,
    },
    {
      name: "JSONC comments between duplicates",
      file: "renma.config.jsonc",
      source:
        '{\n  "security": {\n    "ci_policy": "warn",\n    // A comment must not hide the duplicate syntax-tree property.\n    "ci_policy": "fail"\n  }\n}\n',
      path: "security.ci_policy",
      line: 5,
      column: 5,
    },
  ] as const;

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (caseContext) => {
      const root = await fixture(caseContext);
      const configPath = path.join(root, fixtureCase.file);
      await writeFile(configPath, fixtureCase.source);

      await assert.rejects(loadConfig(root, {}), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /contains duplicate property/);
        assert.match(
          error.message,
          new RegExp(
            `at ${fixtureCase.path} on line ${fixtureCase.line}, column ${fixtureCase.column}`,
          ),
        );
        assert.match(error.message, /first declared on line/);
        return true;
      });
    });
  }
});

test("allows the same property name in distinct sibling objects", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    `{
  "scan_boundary": { "ci_policy": "warn" },
  "security": { "ci_policy": "fail" },
  "quality": { "ci_policy": "warn" }
}
`,
  );

  const loaded = await loadConfig(root, {});

  assert.equal(loaded.config.scanBoundary.ciPolicy, "warn");
  assert.equal(loaded.config.security.ciPolicy, "fail");
  assert.equal(loaded.config.quality.ciPolicy, "warn");
});

test("quality token thresholds reject non-positive or non-safe-integer values", async (t) => {
  const invalidValues: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["string", "5000"],
    ["null", null],
    ["array", [5000]],
    ["object", { value: 5000 }],
  ];

  for (const field of ["skill_token_warning", "skill_token_high"] as const) {
    for (const [label, value] of invalidValues) {
      await t.test(`${field} ${label}`, async (caseContext) => {
        const root = await fixture(caseContext);
        await writeFile(
          path.join(root, "renma.config.json"),
          JSON.stringify({ quality: { [field]: value } }),
        );

        await assert.rejects(
          loadConfig(root, {}),
          (error: unknown) =>
            error instanceof ConfigError &&
            error.message ===
              `quality.${field} must be a positive safe integer.`,
        );
      });
    }
  }
});

test("quality token thresholds require warning to be strictly lower than high", async (t) => {
  const cases = [
    {
      source: { skill_token_warning: 6000, skill_token_high: 6000 },
      message:
        "quality.skill_token_warning (6000) must be strictly lower than quality.skill_token_high (6000).",
    },
    {
      source: { skill_token_warning: 9000 },
      message:
        "quality.skill_token_warning (9000) must be strictly lower than quality.skill_token_high (8000).",
    },
    {
      source: { skill_token_high: 4000 },
      message:
        "quality.skill_token_warning (6400) must be strictly lower than quality.skill_token_high (4000).",
    },
  ] as const;

  for (const config of cases) {
    await t.test(JSON.stringify(config.source), async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(
        path.join(root, "renma.config.jsonc"),
        JSON.stringify({ quality: config.source }),
      );

      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError && error.message === config.message,
      );
    });
  }
});

test("quality configuration rejects unknown keys", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    '{"quality":{"skill_token_warning":5000,"unknown":true}}',
  );

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message ===
        'Unknown quality config key "unknown". Allowed keys: ci_policy, skill_token_warning, skill_token_high, context_token_warning, context_token_high, reference_token_warning, reference_token_high, profile_token_warning, profile_token_high, example_token_warning, example_token_high.',
  );
});

test("quality CI policy defaults to fail and accepts only off warn or fail", async (t) => {
  for (const mode of ["off", "warn", "fail"] as const) {
    await t.test(mode, async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(
        path.join(root, "renma.config.json"),
        JSON.stringify({ quality: { ci_policy: mode } }),
      );
      assert.equal((await loadConfig(root, {})).config.quality.ciPolicy, mode);
    });
  }

  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({ quality: { ci_policy: "ignore" } }),
  );
  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message === "quality.ci_policy must be one of: off, warn, fail.",
  );
});

test("invalid quality configuration is a caller-correctable CLI error", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    '{"quality":{"skill_token_warning":8000,"skill_token_high":8000}}',
  );
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => {
    errors.push(values.join(" "));
  };
  t.after(() => {
    console.error = originalError;
  });

  const exitCode = await main(["scan", root]);

  assert.equal(exitCode, 2);
  assert.deepEqual(errors, [
    "quality.skill_token_warning (8000) must be strictly lower than quality.skill_token_high (8000).",
  ]);
});

test("continues discovering the comment-free v1 JSON filename", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.json"),
    '{"fail_on":"critical"}\n',
  );

  const loaded = await loadConfig(root, {});

  assert.equal(loaded.configPath, "renma.config.json");
  assert.equal(loaded.config.failOn, "critical");
});

test("legacy .renma.json fails with migration guidance", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, ".renma.json"), '{"fail_on":"critical"}\n');

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /\.renma\.json is not supported in v1/.test(error.message) &&
      /renma\.config\.json/.test(error.message) &&
      /renma\.config\.jsonc/.test(error.message),
  );
});

test("rejects ambiguous conventional configuration without parsing files", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "renma.config.jsonc"), "{ malformed\n");
  await writeFile(path.join(root, "renma.config.json"), "{}\n");

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /renma\.config\.jsonc, renma\.config\.json/.test(error.message) &&
      /one unambiguous repository configuration/.test(error.message) &&
      /Keep renma\.config\.jsonc when comments are desired/.test(error.message),
  );
});

test("explicit config selects JSONC even when conventional files coexist", async (t) => {
  const root = await fixture(t);
  const explicitPath = path.join(root, "review.jsonc");
  await writeFile(path.join(root, "renma.config.jsonc"), "{ malformed\n");
  await writeFile(path.join(root, "renma.config.json"), "{}\n");
  await writeFile(
    explicitPath,
    '{\n  // Explicit review policy.\n  "fail_on": "low"\n}\n',
  );

  const loaded = await loadConfig(root, { configPath: explicitPath });

  assert.equal(loaded.configPath, "review.jsonc");
  assert.equal(loaded.config.failOn, "low");
});

test("reports actionable JSONC syntax errors with source location", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    '{\n  // rationale\n  "format":\n}\n',
  );

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /Config file .*renma\.config\.jsonc is not valid JSONC at line 4, column 1: ValueExpected\./.test(
        error.message,
      ) &&
      !error.message.includes("at readConfigFile"),
  );
});

test("keeps JSON strict and labels its syntax errors accurately", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.json"),
    '{\n  // JSON comments are not accepted.\n  "format": "text"\n}\n',
  );

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /is not valid JSON at line 2, column 3: InvalidCommentToken\./.test(
        error.message,
      ),
  );
});

test("rejects unsupported explicit config extensions", async (t) => {
  const root = await fixture(t);
  const configPath = path.join(root, "renma.config.mjs");
  await writeFile(configPath, "export default {};\n");

  await assert.rejects(
    loadConfig(root, { configPath }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /must use \.json or \.jsonc/.test(error.message) &&
      /executable \.js, \.mjs, and \.ts configuration is not supported/.test(
        error.message,
      ),
  );
});

test("conventional JSON and JSONC config symlinks fail instead of becoming policy", async (t) => {
  for (const filename of ["renma.config.json", "renma.config.jsonc"]) {
    await t.test(filename, async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(path.join(root, "policy.json"), '{"format":"json"}\n');
      await symlink("policy.json", path.join(root, filename));

      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError &&
          /crosses symbolic link/.test(error.message) &&
          /non-symlink regular file inside the repository/.test(error.message),
      );
    });
  }
});

test("conventional config symlinks fail for external, internal, and broken targets", async (t) => {
  const cases = [
    { name: "external", target: "outside" },
    { name: "internal", target: "inside" },
    { name: "broken", target: "missing" },
  ] as const;
  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (caseContext) => {
      const root = await fixture(caseContext);
      const outside = await fixture(caseContext);
      const target =
        fixtureCase.target === "outside"
          ? path.join(outside, "external.json")
          : fixtureCase.target === "inside"
            ? path.join(root, "internal.json")
            : path.join(root, "missing.json");
      if (fixtureCase.target !== "missing") {
        await writeFile(target, '{"format":"json"}\n');
      }
      await symlink(target, path.join(root, "renma.config.json"));

      await assert.rejects(loadConfig(root, {}), ConfigError);
    });
  }
});

test("explicit config is repository-contained and rejects symlink traversal", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const externalConfig = path.join(outside, "review.json");
  await writeFile(externalConfig, "{}\n");

  await assert.rejects(
    loadConfig(root, { configPath: externalConfig }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /must be a regular file inside repository root/.test(error.message),
  );

  const realDirectory = path.join(root, "real-config");
  await mkdir(realDirectory);
  const nestedConfig = path.join(realDirectory, "review.jsonc");
  await writeFile(nestedConfig, "{}\n");
  await symlink("real-config", path.join(root, "config"));

  await assert.rejects(
    loadConfig(root, { configPath: path.join(root, "config", "review.jsonc") }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /crosses symbolic link config/.test(error.message),
  );
});

test("JSONC retains unknown-field and semantic validation", async (t) => {
  const cases: Array<[string, RegExp]> = [
    ['{"unknown": true}', /"unknown" \(unknown\)/],
    ['{"__proto__": {"polluted": true}}', /"__proto__" \(unknown\)/],
    ['{"max_depth": 0}', /max_depth must be a positive integer/],
    [
      '{"skill_discovery":{"adopted":false,"ci_policy":"warn"}}',
      /ci_policy "warn" requires skill_discovery\.adopted to be true/,
    ],
  ];

  for (const [source, expected] of cases) {
    await t.test(source, async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(path.join(root, "renma.config.jsonc"), `${source}\n`);
      await assert.rejects(loadConfig(root, {}), expected);
    });
  }
});

test("JSONC aggregates removed and historical configuration keys", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    `{
  "layout": {
    "tool_namespace": "appium"
  },
  "security": {
    "profiles": {
      "restricted": {
        // Historical spellings must be migrated before v1 policy is trusted.
        "networkAllowed": false,
        "network_allowed": true
      }
    }
  }
}
`,
  );

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /Top-level configuration:[\s\S]*"layout".*\(removed\)/.test(
        error.message,
      ) &&
      /security\.profiles\.restricted/.test(error.message) &&
      /"networkAllowed" -> use "network_allowed" \(historical\)/.test(
        error.message,
      ),
  );
});

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "renma-jsonc-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}
