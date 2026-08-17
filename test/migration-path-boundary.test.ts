import assert from "node:assert/strict";
import test from "node:test";

import { classifyRepositorySkillMigrationEntrypointPath } from "../src/skill-path-contract.js";

test("migration-only Skill paths normalize only within their original root", () => {
  assert.equal(
    classifyRepositorySkillMigrationEntrypointPath(
      "./skills/domain/../demo/skill.md",
    )?.targetPath,
    "skills/demo/SKILL.md",
  );
  assert.equal(
    classifyRepositorySkillMigrationEntrypointPath(
      ".agents/skills/domain/../legacy.skill.md",
    )?.targetPath,
    ".agents/skills/legacy/SKILL.md",
  );
});

test("migration-only Skill paths cannot escape and re-enter another root", () => {
  for (const relativePath of [
    "skills/demo/../../docs/legacy.skill.md",
    "skills/demo/../../.agents/skills/legacy.skill.md",
    ".agents/skills/demo/../../../skills/legacy.skill.md",
    "skills/../skills/legacy.skill.md",
  ]) {
    assert.equal(
      classifyRepositorySkillMigrationEntrypointPath(relativePath),
      undefined,
      relativePath,
    );
  }
});
