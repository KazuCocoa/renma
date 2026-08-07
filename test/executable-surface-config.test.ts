import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

test("executable-surface CI policy defaults to off", async (t) => {
  const root = await configFixture(t);
  const loaded = await loadConfig(root, {});

  assert.equal(loaded.config.executableSurface.ciPolicy, "off");
});

test("executable-surface CI policy accepts off warn and fail", async (t) => {
  for (const mode of ["off", "warn", "fail"] as const) {
    await t.test(mode, async (caseContext) => {
      const root = await configFixture(caseContext, {
        executable_surface: { ci_policy: mode },
      });
      const loaded = await loadConfig(root, {});
      assert.equal(loaded.config.executableSurface.ciPolicy, mode);
    });
  }
});

test("executable-surface CI policy validation is strict", async (t) => {
  for (const [config, expected] of [
    [{ executable_surface: true }, /executable_surface must be an object\./],
    [
      { executable_surface: { ci_policy: true } },
      /executable_surface\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { executable_surface: { ci_policy: "block" } },
      /executable_surface\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { executable_surface: { unknown: true } },
      /Unknown executable_surface config key "unknown"\. Allowed keys: ci_policy\./,
    ],
  ] as const) {
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

test("snapshot executable-surface CI policy config is immutable", async (t) => {
  const root = await configFixture(t, {
    executable_surface: { ci_policy: "warn" },
  });
  const snapshot = await collectRepositorySnapshot(root);

  assert.equal(snapshot.config.executableSurface.ciPolicy, "warn");
  assert.throws(() => {
    snapshot.config.executableSurface.ciPolicy = "off";
  }, TypeError);
});

async function configFixture(
  t: test.TestContext,
  config?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-executable-ci-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  if (config !== undefined) {
    await writeFile(
      join(root, "renma.config.json"),
      `${JSON.stringify(config)}\n`,
    );
  }
  return root;
}
