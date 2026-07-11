import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import {
  classifyAbsoluteSkillEntrypointPath,
  classifyRepositorySkillEntrypointPath,
  discoverArtifacts,
} from "../src/discovery.js";

test("repository Skill roots are anchored and do not restart in nested directories", () => {
  assert.equal(
    classifyRepositorySkillEntrypointPath("skills/demo/SKILL.md")?.kind,
    "canonical",
  );
  assert.equal(
    classifyRepositorySkillEntrypointPath(".agents/skills/demo/SKILL.md")?.kind,
    "canonical",
  );
  for (const rejected of [
    "docs/skills/demo/SKILL.md",
    "examples/skills/demo/SKILL.md",
    "skills/demo/references/skills/example/SKILL.md",
    "skills/demo/examples/skills/example/SKILL.md",
  ]) {
    assert.equal(
      classifyRepositorySkillEntrypointPath(rejected),
      undefined,
      rejected,
    );
  }
});

test("absolute Skill paths require one unambiguous repository root", () => {
  assert.equal(
    classifyAbsoluteSkillEntrypointPath("/tmp/repository/skills/demo/skill.md")
      ?.kind,
    "lowercase-entrypoint",
  );
  assert.equal(
    classifyAbsoluteSkillEntrypointPath(
      "/tmp/repository/.agents/skills/demo/SKILL.md",
    )?.kind,
    "canonical",
  );
  assert.equal(
    classifyAbsoluteSkillEntrypointPath(
      "/tmp/skills/repository/skills/demo/SKILL.md",
    ),
    undefined,
  );
  assert.equal(
    classifyAbsoluteSkillEntrypointPath(
      "/tmp/repository/skills/demo/references/skills/example/SKILL.md",
    ),
    undefined,
  );
});

test("artifact classification preserves nested support and outside-root kinds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-skill-roots-"));
  const fixtures = [
    "skills/demo/SKILL.md",
    ".agents/skills/demo/SKILL.md",
    "docs/skills/demo/SKILL.md",
    "skills/demo/references/skills/example/SKILL.md",
    "skills/demo/examples/skills/example/SKILL.md",
  ];
  for (const fixture of fixtures) {
    const target = path.join(root, ...fixture.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Fixture\n");
  }

  const { artifacts } = await discoverArtifacts(root, {
    ...DEFAULT_CONFIG,
    globs: ["**/SKILL.md", ".agents/**/SKILL.md"],
  });
  const kinds = Object.fromEntries(
    artifacts.map((artifact) => [artifact.path, artifact.kind]),
  );

  assert.equal(kinds["skills/demo/SKILL.md"], "skill");
  assert.equal(kinds[".agents/skills/demo/SKILL.md"], "skill");
  assert.equal(kinds["docs/skills/demo/SKILL.md"], "unknown");
  assert.equal(
    kinds["skills/demo/references/skills/example/SKILL.md"],
    "reference",
  );
  assert.equal(
    kinds["skills/demo/examples/skills/example/SKILL.md"],
    "example",
  );
});
