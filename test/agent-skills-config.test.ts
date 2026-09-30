import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";

test("Agent Skills name uniqueness defaults to optional", async (t) => {
  const root = await configFixture(t);
  const loaded = await loadConfig(root, {});

  assert.deepEqual(loaded.config.agentSkills, {
    nameUniqueness: "optional",
  });
  assert.equal(loaded.configPath, undefined);
});

test("Agent Skills name uniqueness accepts optional and required", async (t) => {
  for (const nameUniqueness of ["optional", "required"] as const) {
    await t.test(nameUniqueness, async (caseContext) => {
      const root = await configFixture(caseContext, {
        agent_skills: { name_uniqueness: nameUniqueness },
      });
      const loaded = await loadConfig(root, {});

      assert.equal(loaded.config.agentSkills.nameUniqueness, nameUniqueness);
      assert.equal(loaded.configPath, "renma.config.json");
    });
  }
});

test("Agent Skills name uniqueness config is strict and actionable", async (t) => {
  const cases: Array<[unknown, RegExp]> = [
    [{ agent_skills: true }, /agent_skills must be an object\./],
    [
      { agent_skills: { name_uniqueness: "global" } },
      /agent_skills\.name_uniqueness must be one of: optional, required\./,
    ],
    [
      { agent_skills: { name_uniqueness: true } },
      /agent_skills\.name_uniqueness must be one of: optional, required\./,
    ],
    [
      { agent_skills: { name_uniqueness: "optional", unknown: true } },
      /agent_skills:[\s\S]*"unknown" \(unknown\)[\s\S]*Allowed agent_skills keys: name_uniqueness\./,
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

async function configFixture(
  t: test.TestContext,
  config?: unknown,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-agent-skills-config-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  if (config !== undefined) {
    await writeFile(
      join(root, "renma.config.json"),
      `${JSON.stringify(config)}\n`,
    );
  }
  return root;
}
