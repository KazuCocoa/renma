import assert from "node:assert/strict";
import test from "node:test";

import * as discovery from "../src/public-discovery.js";
import type {
  CanonicalSkillEntrypointPath,
  RepositorySkillPath,
  ReservedSkillSupportDirectory,
  SkillRoot,
} from "../src/public-discovery.js";

test("public discovery runtime surface is explicit and pure", () => {
  assert.deepEqual(Object.keys(discovery).sort(), [
    "RESERVED_SKILL_SUPPORT_DIRS",
    "SKILL_ROOTS",
    "SKILL_SUPPORT_DISCOVERY_MODE",
    "classifyAssetPath",
    "classifyRepositorySkillEntrypointPath",
    "classifyRepositorySkillPath",
    "logicalSkillDirectory",
    "normalizeAssetRepositoryRelativePath",
    "normalizeRepositorySkillRelativePath",
  ]);

  assert.equal("discoverArtifacts" in discovery, false);
  assert.equal("repositoryClassificationPath" in discovery, false);
  assert.equal("classifyAbsoluteSkillEntrypointPath" in discovery, false);
});

test("public discovery declarations expose the intended path-contract types", () => {
  const root: SkillRoot = "skills";
  const support: ReservedSkillSupportDirectory = "references";
  const entrypoint: CanonicalSkillEntrypointPath = {
    kind: "canonical",
    currentPath: "skills/demo/SKILL.md",
    targetPath: "skills/demo/SKILL.md",
    candidateName: "demo",
  };
  const repositoryPath: RepositorySkillPath = {
    kind: "entrypoint",
    currentPath: "skills/demo/SKILL.md",
    root,
    skillDirectory: "skills/demo",
    skillName: "demo",
    domainPath: [],
    relativeToSkillDirectory: "SKILL.md",
    entrypoint,
  };

  assert.equal(repositoryPath.root, root);
  assert.equal(support, "references");
});

type PublicMigrationEntrypoint =
  // @ts-expect-error Migration-only entrypoint variants are not public API.
  import("../src/public-discovery.js").SkillMigrationEntrypointPath;
void (undefined as unknown as PublicMigrationEntrypoint);

type RemovedSkillEntrypointPath =
  // @ts-expect-error The ambiguous pre-1.0 union name is not public API.
  import("../src/public-discovery.js").SkillEntrypointPath;
void (undefined as unknown as RemovedSkillEntrypointPath);

const historicalEntrypointIsNotCanonical: CanonicalSkillEntrypointPath = {
  // @ts-expect-error Public operational entrypoints accept only exact SKILL.md.
  kind: "lowercase-entrypoint",
  currentPath: "skills/demo/skill.md",
  targetPath: "skills/demo/SKILL.md",
  candidateName: "demo",
};
void historicalEntrypointIsNotCanonical;
