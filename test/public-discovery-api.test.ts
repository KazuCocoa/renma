import assert from "node:assert/strict";
import test from "node:test";

import * as discovery from "../src/public-discovery.js";
import type {
  RepositorySkillPath,
  ReservedSkillSupportDirectory,
  SkillEntrypointPath,
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
    "normalizeRepositoryRelativePath",
  ]);

  assert.equal("discoverArtifacts" in discovery, false);
  assert.equal("repositoryClassificationPath" in discovery, false);
  assert.equal("classifyAbsoluteSkillEntrypointPath" in discovery, false);
});

test("public discovery declarations expose the intended path-contract types", () => {
  const root: SkillRoot = "skills";
  const support: ReservedSkillSupportDirectory = "references";
  const entrypoint: SkillEntrypointPath = {
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
