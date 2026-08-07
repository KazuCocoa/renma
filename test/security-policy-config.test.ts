import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

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
