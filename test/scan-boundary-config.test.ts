import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

test("scan-boundary CI policy defaults to fail", async (t) => {
  const root = await configFixture(t);
  const loaded = await loadConfig(root, {});

  assert.equal(loaded.config.scanBoundary.ciPolicy, "fail");
});

test("scan-boundary CI policy accepts off warn and fail", async (t) => {
  for (const mode of ["off", "warn", "fail"] as const) {
    await t.test(mode, async (caseContext) => {
      const root = await configFixture(caseContext, {
        scan_boundary: { ci_policy: mode },
      });
      const loaded = await loadConfig(root, {});
      assert.equal(loaded.config.scanBoundary.ciPolicy, mode);
    });
  }
});

test("scan-boundary CI policy validation is strict and actionable", async (t) => {
  for (const [config, expected] of [
    [
      { scan_boundary: { ci_policy: true } },
      /scan_boundary\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { scan_boundary: { ci_policy: "block" } },
      /scan_boundary\.ci_policy must be one of: off, warn, fail\./,
    ],
    [
      { scan_boundary: { unknown: true } },
      /scan_boundary:[\s\S]*"unknown" \(unknown\)[\s\S]*Allowed scan_boundary keys: ci_policy\./,
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

test("snapshot scan-boundary CI policy config is immutable", async (t) => {
  const root = await configFixture(t, {
    scan_boundary: { ci_policy: "warn" },
  });
  const snapshot = await collectRepositorySnapshot(root);

  assert.equal(snapshot.config.scanBoundary.ciPolicy, "warn");
  assert.throws(() => {
    snapshot.config.scanBoundary.ciPolicy = "off";
  }, TypeError);
});

async function configFixture(
  t: test.TestContext,
  config?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-boundary-ci-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  if (config !== undefined) {
    await writeFile(
      join(root, "renma.config.json"),
      `${JSON.stringify(config)}\n`,
    );
  }
  return root;
}
