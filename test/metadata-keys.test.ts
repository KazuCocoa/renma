import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("metadata-keys returns deterministic vocabulary without loading repository configuration", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "renma-metadata-keys-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "renma.config.jsonc"), "invalid config");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, "metadata-keys", ...args], {
      cwd,
      encoding: "utf8",
    });
  const json = run("--json");
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stderr, "");
  assert.equal(run("--format", "json").stdout, json.stdout);
  const keys = JSON.parse(json.stdout) as Record<string, string[]>;
  assert.deepEqual(Object.keys(keys), [
    "skill",
    "nonSkill",
    "agentSkillTopLevel",
  ]);
  for (const [group, values] of Object.entries(keys)) {
    assert.equal(values.length, new Set(values).size, group);
  }
  for (const key of [
    "renma.id",
    "renma.requires-human-approval",
    "renma.published-entrypoint",
    "renma.asset-bindings",
  ]) {
    assert.ok(keys.skill?.includes(key), key);
  }
  for (const key of [
    "id",
    "requires_human_approval",
    "scope",
    "release_version",
    "asset_bindings",
    "token_budget_override",
  ]) {
    assert.ok(keys.nonSkill?.includes(key), key);
  }
  assert.ok(!keys.nonSkill?.includes("published_entrypoint"));
  assert.deepEqual(keys.agentSkillTopLevel, [
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
  ]);
  const text = run();
  assert.equal(text.status, 0, text.stderr);
  assert.equal(run("--format", "text").stdout, text.stdout);
  for (const [group, values] of Object.entries(keys)) {
    assert.ok(
      text.stdout.includes(
        `${group}:\n${values.map((key) => `  ${key}`).join("\n")}`,
      ),
    );
  }
  for (const args of [
    ["."],
    ["--config", "missing.json"],
    ["--format", "yaml"],
  ]) {
    const invalid = run(...args);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /renma metadata-keys --help/);
  }
});
