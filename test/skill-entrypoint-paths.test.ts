import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import {
  classifyAssetPath,
  classifyAbsoluteSkillEntrypointPath,
  classifyRepositorySkillEntrypointPath,
  classifyRepositorySkillPath,
  discoverArtifacts,
  normalizeRepositorySkillRelativePath,
  RESERVED_SKILL_SUPPORT_DIRS,
  SKILL_ROOTS,
  SKILL_SUPPORT_DISCOVERY_MODE,
} from "../src/discovery.js";
import {
  classifyAbsoluteSkillMigrationEntrypointPath,
  classifyRepositorySkillMigrationEntrypointPath,
} from "../src/skill-path-contract.js";

test("repository-relative Skill paths normalize dots without escaping roots", () => {
  const accepted = [
    ["./skills/demo/SKILL.md", "skills/demo/SKILL.md", "canonical"],
    ["skills/demo/./SKILL.md", "skills/demo/SKILL.md", "canonical"],
    ["skills/demo/../demo/SKILL.md", "skills/demo/SKILL.md", "canonical"],
  ] as const;
  for (const [input, normalized, kind] of accepted) {
    assert.equal(
      normalizeRepositorySkillRelativePath(input),
      normalized,
      input,
    );
    const classified = classifyRepositorySkillEntrypointPath(input);
    assert.equal(classified?.currentPath, normalized, input);
    assert.equal(classified?.kind, kind, input);
  }

  assert.equal(
    normalizeRepositorySkillRelativePath("./skills/demo/skill.md"),
    "skills/demo/skill.md",
  );
  assert.equal(
    classifyRepositorySkillEntrypointPath("./skills/demo/skill.md"),
    undefined,
  );
  assert.deepEqual(
    classifyRepositorySkillMigrationEntrypointPath("./skills/demo/skill.md"),
    {
      kind: "lowercase-entrypoint",
      currentPath: "skills/demo/skill.md",
      targetPath: "skills/demo/SKILL.md",
      candidateName: "demo",
    },
  );

  for (const rejected of [
    "skills/../docs/SKILL.md",
    "skills/demo/../../docs/SKILL.md",
    ".agents/skills/../../docs/SKILL.md",
  ]) {
    assert.equal(
      normalizeRepositorySkillRelativePath(rejected),
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

test("directory-based Skill entrypoints require a Skill directory below either root", () => {
  for (const root of SKILL_ROOTS) {
    const rootEntrypoint = `${root}/SKILL.md`;
    const rootLowercaseEntrypoint = `${root}/skill.md`;
    const canonicalEntrypoint = `${root}/demo/SKILL.md`;
    const lowercaseEntrypoint = `${root}/demo/skill.md`;
    const historicalFlatEntrypoint = `${root}/demo.skill.md`;

    assert.equal(
      classifyRepositorySkillEntrypointPath(rootEntrypoint),
      undefined,
      rootEntrypoint,
    );
    assert.equal(
      classifyRepositorySkillPath(rootEntrypoint),
      undefined,
      rootEntrypoint,
    );
    assert.equal(
      classifyAbsoluteSkillEntrypointPath(`/tmp/repository/${rootEntrypoint}`),
      undefined,
      rootEntrypoint,
    );
    assert.equal(
      classifyRepositorySkillEntrypointPath(rootLowercaseEntrypoint),
      undefined,
      rootLowercaseEntrypoint,
    );
    assert.equal(
      classifyAbsoluteSkillEntrypointPath(
        `/tmp/repository/${rootLowercaseEntrypoint}`,
      ),
      undefined,
      rootLowercaseEntrypoint,
    );
    assert.equal(
      classifyRepositorySkillEntrypointPath(canonicalEntrypoint)?.kind,
      "canonical",
      canonicalEntrypoint,
    );
    assert.equal(
      classifyRepositorySkillEntrypointPath(lowercaseEntrypoint)?.kind,
      undefined,
      lowercaseEntrypoint,
    );
    assert.equal(
      classifyAbsoluteSkillEntrypointPath(
        `/tmp/repository/${lowercaseEntrypoint}`,
      )?.kind,
      undefined,
      lowercaseEntrypoint,
    );
    assert.equal(
      classifyAbsoluteSkillEntrypointPath(
        `/tmp/repository/${canonicalEntrypoint}`,
      )?.kind,
      "canonical",
      canonicalEntrypoint,
    );
    assert.deepEqual(
      classifyRepositorySkillMigrationEntrypointPath(historicalFlatEntrypoint),
      {
        kind: "flat-legacy-entrypoint",
        currentPath: historicalFlatEntrypoint,
        targetPath: `${root}/demo/SKILL.md`,
        candidateName: "demo",
      },
      historicalFlatEntrypoint,
    );
    assert.equal(
      classifyAbsoluteSkillMigrationEntrypointPath(
        `/tmp/repository/${historicalFlatEntrypoint}`,
      )?.kind,
      "flat-legacy-entrypoint",
      historicalFlatEntrypoint,
    );
  }
});

test("every reserved support directory has identical classification at both Skill roots", () => {
  for (const root of SKILL_ROOTS) {
    for (const supportDirectory of RESERVED_SKILL_SUPPORT_DIRS) {
      const reservedRootPath = `${root}/${supportDirectory}/SKILL.md`;
      const reservedRoot = classifyRepositorySkillPath(reservedRootPath);
      assert.equal(
        classifyRepositorySkillEntrypointPath(reservedRootPath),
        undefined,
        reservedRootPath,
      );
      assert.deepEqual(reservedRoot, {
        kind: "reserved-root",
        currentPath: reservedRootPath,
        root,
        supportDirectory,
      });

      for (const relativeSupportPath of [
        `${supportDirectory}/SKILL.md`,
        `${supportDirectory}/vendor/SKILL.md`,
      ]) {
        const supportPath = `${root}/demo/${relativeSupportPath}`;
        const support = classifyRepositorySkillPath(supportPath);
        assert.equal(
          classifyRepositorySkillEntrypointPath(supportPath),
          undefined,
          supportPath,
        );
        assert.equal(support?.kind, "support", supportPath);
        if (support?.kind !== "support") continue;
        assert.equal(support.root, root, supportPath);
        assert.equal(support.skillDirectory, `${root}/demo`, supportPath);
        assert.equal(support.skillName, "demo", supportPath);
        assert.deepEqual(support.domainPath, [], supportPath);
        assert.equal(
          support.relativeToSkillDirectory,
          relativeSupportPath,
          supportPath,
        );
        assert.equal(support.supportDirectory, supportDirectory, supportPath);
      }
    }
  }
  assert.equal(
    classifyRepositorySkillEntrypointPath(
      "skills/demo/assets/example.skill.md",
    ),
    undefined,
  );
});

test("ordinary domain nesting remains valid while reserved segments block entrypoints", () => {
  for (const skillPath of [
    "skills/payments/refund/SKILL.md",
    "skills/platform/ios/setup/SKILL.md",
    ".agents/skills/payments/refund/SKILL.md",
  ]) {
    assert.equal(
      classifyRepositorySkillEntrypointPath(skillPath)?.kind,
      "canonical",
      skillPath,
    );
    assert.equal(classifyRepositorySkillPath(skillPath)?.kind, "entrypoint");
  }

  for (const reservedPath of [
    "skills/payments/references/refund/SKILL.md",
    "skills/platform/assets/ios/setup/SKILL.md",
    ".agents/skills/payments/scripts/refund/SKILL.md",
  ]) {
    assert.equal(
      classifyRepositorySkillEntrypointPath(reservedPath),
      undefined,
      reservedPath,
    );
    assert.equal(
      classifyRepositorySkillPath(reservedPath)?.kind,
      "support",
      reservedPath,
    );
  }
});

test("default support discovery globs preserve mode and root parity", () => {
  for (const root of SKILL_ROOTS) {
    const expected = RESERVED_SKILL_SUPPORT_DIRS.map((directory) =>
      SKILL_SUPPORT_DISCOVERY_MODE[directory] === "markdown"
        ? `${root}/**/${directory}/**/*.md`
        : `${root}/**/${directory}/**/*`,
    );
    for (const glob of expected) {
      assert.equal(DEFAULT_CONFIG.globs.includes(glob), true, glob);
    }
  }

  assert.equal(
    DEFAULT_CONFIG.globs.includes("skills/**/references/**/*"),
    true,
  );
  assert.equal(
    DEFAULT_CONFIG.globs.includes("skills/**/references/**/*.md"),
    false,
  );
  assert.deepEqual(SKILL_SUPPORT_DISCOVERY_MODE, {
    assets: "all-files",
    examples: "markdown",
    profiles: "markdown",
    references: "all-files",
    scripts: "all-files",
  });
});

test("absolute Skill paths require one unambiguous repository root", () => {
  assert.equal(
    classifyAbsoluteSkillEntrypointPath("/tmp/repository/skills/demo/skill.md")
      ?.kind,
    undefined,
  );
  assert.equal(
    classifyAbsoluteSkillMigrationEntrypointPath(
      "/tmp/repository/skills/demo/skill.md",
    )?.kind,
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

test("historical Skill filenames are migration-only even under custom globs", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-skill-migration-only-"),
  );
  for (const relativePath of ["skills/demo/skill.md", "skills/flat.skill.md"]) {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Historical\n");
  }

  const result = await discoverArtifacts(root, {
    ...DEFAULT_CONFIG,
    globs: ["skills/**/*.md"],
  });

  assert.deepEqual(
    result.artifacts.map((artifact) => [artifact.path, artifact.kind]),
    [
      ["skills/demo/skill.md", "unknown"],
      ["skills/flat.skill.md", "unknown"],
    ],
  );
  assert.deepEqual(
    result.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.code === "LAYOUT-HISTORICAL-SKILL-ENTRYPOINT",
      )
      .map((diagnostic) => diagnostic.path),
    ["skills/demo/skill.md", "skills/flat.skill.md"],
  );
});

test("DEFAULT_CONFIG discovers Markdown and non-Markdown references equivalently at both Skill roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-reference-roots-"));
  const referenceFiles = [
    "api.md",
    "schema.json",
    "sample.yaml",
    "query.sql",
    "data.txt",
  ] as const;

  for (const skillRoot of SKILL_ROOTS) {
    const skillDirectory = `${skillRoot}/demo`;
    const entrypoint = path.join(
      root,
      ...skillDirectory.split("/"),
      "SKILL.md",
    );
    await mkdir(path.dirname(entrypoint), { recursive: true });
    await writeFile(entrypoint, "# Demo\n");
    for (const referenceFile of referenceFiles) {
      const target = path.join(
        root,
        ...skillDirectory.split("/"),
        "references",
        referenceFile,
      );
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `fixture: ${referenceFile}\n`);
    }
  }

  const discovered = await discoverArtifacts(root, DEFAULT_CONFIG);
  assert.equal(discovered.artifacts.length, 12);

  for (const skillRoot of SKILL_ROOTS) {
    const skillDirectory = `${skillRoot}/demo`;
    const entrypointPath = `${skillDirectory}/SKILL.md`;
    assert.equal(
      discovered.artifacts.find(({ path }) => path === entrypointPath)?.kind,
      "skill",
      entrypointPath,
    );

    for (const referenceFile of referenceFiles) {
      const referencePath = `${skillDirectory}/references/${referenceFile}`;
      const artifact = discovered.artifacts.find(
        ({ path }) => path === referencePath,
      );
      const structural = classifyRepositorySkillPath(referencePath);
      const classification = classifyAssetPath(referencePath);

      assert.equal(artifact?.kind, "reference", referencePath);
      assert.equal(artifact?.contentClassification, "text", referencePath);
      assert.equal(
        artifact?.markdownParserEligible,
        referenceFile.endsWith(".md"),
        referencePath,
      );
      assert.equal(structural?.kind, "support", referencePath);
      if (structural?.kind === "support") {
        assert.equal(structural.skillDirectory, skillDirectory, referencePath);
        assert.equal(structural.supportDirectory, "references", referencePath);
      }
      assert.equal(classification.kind, "reference", referencePath);
      assert.equal(classification.scope, "skill-local", referencePath);
      assert.equal(
        classification.matchedRule,
        "skill-local-support",
        referencePath,
      );
      assert.equal(
        classifyRepositorySkillEntrypointPath(referencePath),
        undefined,
        referencePath,
      );
    }
  }
});
