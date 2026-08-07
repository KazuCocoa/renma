import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";

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
});

test("continues discovering legacy JSON configuration filenames", async (t) => {
  for (const filename of ["renma.config.json", ".renma.json"] as const) {
    await t.test(filename, async (caseContext) => {
      const root = await fixture(caseContext);
      await writeFile(path.join(root, filename), '{"fail_on":"critical"}\n');

      const loaded = await loadConfig(root, {});

      assert.equal(loaded.configPath, filename);
      assert.equal(loaded.config.failOn, "critical");
    });
  }
});

test("rejects ambiguous conventional configuration without parsing files", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "renma.config.jsonc"), "{ malformed\n");
  await writeFile(path.join(root, "renma.config.json"), "{}\n");
  await writeFile(path.join(root, ".renma.json"), "{}\n");

  await assert.rejects(
    loadConfig(root, {}),
    (error: unknown) =>
      error instanceof ConfigError &&
      /renma\.config\.jsonc, renma\.config\.json, \.renma\.json/.test(
        error.message,
      ) &&
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

test("JSONC retains unknown-field and semantic validation", async (t) => {
  const cases: Array<[string, RegExp]> = [
    ['{"unknown": true}', /Unknown config field "unknown"/],
    ['{"__proto__": {"polluted": true}}', /Unknown config field "__proto__"/],
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

test("JSONC rejects conflicting security profile aliases", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    `{
  "security": {
    "profiles": {
      "restricted": {
        // These aliases express one security boundary and must agree.
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
      /security\.profiles\.restricted/.test(error.message) &&
      /conflicting aliases for networkAllowed/.test(error.message) &&
      /networkAllowed=false/.test(error.message) &&
      /network_allowed=true/.test(error.message),
  );
});

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "renma-jsonc-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}
