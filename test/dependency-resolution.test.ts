import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareDependencyTargetResolver,
  resolveDependencyTarget,
} from "../src/dependency-resolution.js";
import type { Asset, Dependency } from "../src/model.js";

test("prepared resolution retains first-match ordering and unique-path ambiguity", () => {
  const pathMatch = asset("by-path", "contexts/shared.md");
  const idMatch = asset("contexts/shared.md", "contexts/other.md");
  const resolve = prepareDependencyTargetResolver([pathMatch, idMatch]);
  assert.equal(resolve(dependency("contexts/shared.md")), pathMatch);
  assert.equal(
    resolve(dependency("contexts/shared.md", "requires_skill")),
    undefined,
  );
  assert.equal(
    resolve(dependency("contexts/shared.md", "optional_skill")),
    undefined,
  );
  assert.equal(
    prepareDependencyTargetResolver([idMatch, pathMatch])(
      dependency("contexts/shared.md"),
    ),
    idMatch,
  );
});

test("unique resolution retains the last matching entry for one normalized path", () => {
  const first = asset("shared", "./contexts/shared.md");
  const last = asset("shared", "contexts\\shared.md");
  const resolve = prepareDependencyTargetResolver([first, last]);
  assert.equal(resolve(dependency("shared")), first);
  assert.equal(resolve(dependency("shared", "requires_skill")), last);
  assert.equal(
    resolve(dependency("./contexts/shared.md", "optional_skill")),
    last,
  );
  assert.equal(resolve(dependency("missing")), undefined);
});

test("prepared and direct resolution agree across repeated IDs, paths, and input orders", () => {
  const pool = [
    asset("same", "contexts/a.md"),
    asset("same", "contexts/b.md"),
    asset("other", "./contexts/a.md"),
    asset("contexts/a.md", "contexts/c.md"),
    asset("same", "contexts\\a.md"),
  ];
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const selected = pool.filter((_, index) => mask & (1 << index));
    for (const assets of [selected, [...selected].reverse()]) {
      const resolve = prepareDependencyTargetResolver(assets);
      for (const target of [
        "same",
        "other",
        "contexts/a.md",
        "./contexts/a.md",
        "contexts\\b.md",
        "missing",
      ]) {
        for (const declaration of [
          "requires_context",
          "requires_skill",
          "optional_skill",
        ]) {
          const edge = dependency(target, declaration);
          assert.equal(resolve(edge), resolveDependencyTarget(edge, assets));
        }
      }
    }
  }
});

test("repeated lookups do not reread asset paths", () => {
  let pathReads = 0;
  const assets = Array.from({ length: 300 }, (_, index) => ({
    ...asset(`asset-${index}`, ""),
    get sourcePath() {
      pathReads++;
      return `contexts/${index}.md`;
    },
  }));
  const resolve = prepareDependencyTargetResolver(assets);
  for (let index = 0; index < assets.length; index++) {
    assert.equal(resolve(dependency(`contexts/${index}.md`)), assets[index]);
    assert.equal(
      resolve(dependency(`asset-${index}`, "requires_skill")),
      assets[index],
    );
  }
  assert.equal(pathReads, assets.length);
});

function dependency(to: string, declaration = "requires_context"): Dependency {
  return {
    from: "root",
    to,
    kind: "requires",
    declaration,
    sourcePath: "skills/root/SKILL.md",
  };
}

function asset(id: string, sourcePath: string): Asset {
  return {
    id,
    kind: "context",
    sourcePath,
    contentHash: `sha256:${id}`,
    sizeBytes: 1,
    contentClassification: "text",
    markdownParserEligible: true,
    ownership: { declaredOwner: null, effectiveOwner: null, source: "unowned" },
    metadata: {
      tags: [],
      whenToUse: [],
      whenNotToUse: [],
      requiresContext: [],
      optionalContext: [],
      conflicts: [],
      supersededBy: [],
    },
    metadataFields: {},
    metadataListItems: {},
  };
}
