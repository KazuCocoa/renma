import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

test("Skill Discovery CI policy defaults to off", async (t) => {
  const root = await configFixture(t);
  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.skillDiscovery, {
    adopted: false,
    ciPolicy: "off",
  });
  assert.equal(loaded.configPath, undefined);
});

test("Skill Discovery CI policy accepts explicit off", async (t) => {
  const root = await configFixture(t, {
    skill_discovery: {
      adopted: false,
      ci_policy: "off",
    },
  });
  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.skillDiscovery, {
    adopted: false,
    ciPolicy: "off",
  });
  assert.equal(loaded.configPath, "renma.config.json");
});

test("Skill Discovery CI policy accepts warn only with adoption", async (t) => {
  const root = await configFixture(t, {
    skill_discovery: {
      adopted: true,
      ci_policy: "warn",
    },
  });
  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.skillDiscovery, {
    adopted: true,
    ciPolicy: "warn",
  });
});

test("Skill Discovery CI policy validation is strict and actionable", async (t) => {
  const cases: Array<[unknown, RegExp]> = [
    [
      { skill_discovery: { adopted: true, unknown: true } },
      /Unknown skill_discovery config key "unknown".*adopted, ci_policy/,
    ],
    [
      { skill_discovery: { adopted: true, ci_policy: true } },
      /skill_discovery\.ci_policy must be one of: off, warn\./,
    ],
    [
      { skill_discovery: { adopted: true, ci_policy: "fail" } },
      /skill_discovery\.ci_policy must be one of: off, warn\./,
    ],
    [
      { skill_discovery: { ci_policy: "warn" } },
      /skill_discovery\.ci_policy "warn" requires skill_discovery\.adopted to be true\./,
    ],
    [
      { skill_discovery: { adopted: false, ci_policy: "warn" } },
      /skill_discovery\.ci_policy "warn" requires skill_discovery\.adopted to be true\./,
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

test("Skill Discovery CI policy preserves explicit config-path reporting", async (t) => {
  const root = await configFixture(t);
  const configDirectory = join(root, "config");
  const configPath = join(configDirectory, "review.json");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({
      skill_discovery: { adopted: true, ci_policy: "warn" },
    })}\n`,
  );

  const loaded = await loadConfig(root, { configPath });

  assert.equal(loaded.configPath, "config/review.json");
  assert.equal(loaded.config.skillDiscovery.ciPolicy, "warn");
});

test("snapshot Skill Discovery CI policy config is immutable", async (t) => {
  const root = await configFixture(t, {
    skill_discovery: {
      adopted: true,
      ci_policy: "warn",
    },
  });
  const snapshot = await collectRepositorySnapshot(root);

  assert.equal(snapshot.config.skillDiscovery.ciPolicy, "warn");
  assert.throws(() => {
    snapshot.config.skillDiscovery.ciPolicy = "off";
  }, TypeError);
  assert.equal(snapshot.config.skillDiscovery.ciPolicy, "warn");
});

async function configFixture(
  t: test.TestContext,
  config?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-discovery-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  if (config !== undefined) {
    await writeFile(
      join(root, "renma.config.json"),
      `${JSON.stringify(config)}\n`,
    );
  }
  return root;
}
