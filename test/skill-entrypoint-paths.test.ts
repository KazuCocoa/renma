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
  normalizeRepositoryRelativePath,
} from "../src/discovery.js";

test("repository-relative Skill paths normalize dots without escaping roots", () => {
  const accepted = [
    ["./skills/demo/SKILL.md", "skills/demo/SKILL.md", "canonical"],
    ["./skills/demo/skill.md", "skills/demo/skill.md", "lowercase-entrypoint"],
    ["skills/demo/./SKILL.md", "skills/demo/SKILL.md", "canonical"],
    ["skills/demo/../demo/SKILL.md", "skills/demo/SKILL.md", "canonical"],
  ] as const;
  for (const [input, normalized, kind] of accepted) {
    assert.equal(normalizeRepositoryRelativePath(input), normalized, input);
    const classified = classifyRepositorySkillEntrypointPath(input);
    assert.equal(classified?.currentPath, normalized, input);
    assert.equal(classified?.kind, kind, input);
  }

  for (const rejected of [
    "skills/../docs/SKILL.md",
    "skills/demo/../../docs/SKILL.md",
    ".agents/skills/../../docs/SKILL.md",
  ]) {
    assert.equal(
      normalizeRepositoryRelativePath(rejected),
      undefined,
      rejected,
    );
    assert.equal(
      classifyRepositorySkillEntrypointPath(rejected),
      undefined,
      rejected,
    );
  }
});

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

test("assets and existing reserved support directories are never Skill entrypoints", () => {
  for (const supportDirectory of [
    "assets",
    "examples",
    "profiles",
    "references",
    "scripts",
  ]) {
    for (const entrypoint of [
      `skills/demo/${supportDirectory}/SKILL.md`,
      `.agents/skills/demo/${supportDirectory}/SKILL.md`,
      `skills/${supportDirectory}/SKILL.md`,
      `.agents/skills/${supportDirectory}/SKILL.md`,
    ]) {
      assert.equal(
        classifyRepositorySkillEntrypointPath(entrypoint),
        undefined,
        entrypoint,
      );
    }
  }
  assert.equal(
    classifyRepositorySkillEntrypointPath(
      "skills/demo/assets/example.skill.md",
    ),
    undefined,
  );
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
    "skills/demo/assets/SKILL.md",
    ".agents/skills/demo/assets/SKILL.md",
    "skills/demo/assets/example.skill.md",
    "skills/assets/SKILL.md",
    ".agents/skills/assets/SKILL.md",
  ];
  for (const fixture of fixtures) {
    const target = path.join(root, ...fixture.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Fixture\n");
  }

  const { artifacts, diagnostics } = await discoverArtifacts(root, {
    ...DEFAULT_CONFIG,
    globs: ["**/SKILL.md", "**/*.skill.md", ".agents/**/SKILL.md"],
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
  assert.equal(kinds["skills/demo/assets/SKILL.md"], "asset");
  assert.equal(kinds[".agents/skills/demo/assets/SKILL.md"], "asset");
  assert.equal(kinds["skills/demo/assets/example.skill.md"], "asset");
  for (const reservedPath of [
    "skills/assets/SKILL.md",
    ".agents/skills/assets/SKILL.md",
  ]) {
    assert.equal(kinds[reservedPath], "unknown", reservedPath);
    assert.ok(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code ===
            "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR" &&
          diagnostic.path === reservedPath &&
          diagnostic.details?.reservedSupportSegment === "assets",
      ),
      reservedPath,
    );
  }
});
