import assert from "node:assert/strict";
import test from "node:test";
import { pathPatternMatches } from "../src/suppressions.js";

test("suppression path matcher supports exact path matches", () => {
  assert.equal(
    pathPatternMatches("skills/demo/SKILL.md", "skills/demo/SKILL.md"),
    true,
  );
});

test("suppression path matcher supports directory-prefix matches without globs", () => {
  assert.equal(pathPatternMatches("skills/demo", "skills/demo/SKILL.md"), true);
});

test("suppression path matcher supports double-star directory globs", () => {
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo/SKILL.md"),
    true,
  );
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo/references/guide.md"),
    true,
  );
});

test("suppression path matcher does not match sibling directories", () => {
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo-other/SKILL.md"),
    false,
  );
});

test("suppression path matcher normalizes backslashes", () => {
  assert.equal(
    pathPatternMatches("skills\\demo\\**", "skills/demo/SKILL.md"),
    true,
  );
});
