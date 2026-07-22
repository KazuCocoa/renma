import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import { catalog } from "../src/commands/catalog.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  normalizeFixturePath,
  RepositoryFixture,
} from "./repository-fixture.js";

test("repository fixture paths normalize separators without escaping the root", () => {
  const segment = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,15}$/);
  fc.assert(
    fc.property(
      fc.array(segment, { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      (segments, useBackslashes) => {
        const separator = useBackslashes ? "\\" : "/";
        assert.equal(
          normalizeFixturePath(segments.join(separator)),
          segments.join("/"),
        );
      },
    ),
    { seed: 22_052, numRuns: 100 },
  );

  for (const unsafe of [
    "/absolute.md",
    "../escape.md",
    "a/../../escape.md",
    ".",
  ]) {
    assert.throws(
      () => normalizeFixturePath(unsafe),
      /must (?:be relative|stay within)/,
    );
  }
});

test("repository fixture builds canonical assets, config, arbitrary files, and Git", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("source", {
    id: "skill.source",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.target"],
    publishedEntrypoint: true,
  });
  await fixture.skill("target", { id: "skill.target", owner: "qa" });
  await fixture.context("contexts/reference.md", {
    id: "context.reference",
    owner: "qa",
    status: "stable",
    whenToUse: ["repository validation"],
    whenNotToUse: ["runtime selection"],
  });
  await fixture.contextLens("lenses/review.md", {
    id: "lens.review",
    owner: "qa",
    purpose: "Review repository evidence.",
    appliesTo: ["context.reference"],
    focus: ["validation"],
    expectedOutputs: ["review"],
  });
  await fixture.write("skills/source/references/note.txt", "evidence\n");
  await fixture.initializeGit();
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "fixture"]);

  assert.match(
    await fixture.read("skills/source/SKILL.md"),
    /renma\.continues-with/,
  );
  assert.match(await fixture.read("renma.config.json"), /skill_discovery/);
  assert.equal(
    await fixture.git(["rev-parse", "--is-inside-work-tree"]),
    "true",
  );
  await access(path.join(fixture.root, "lenses", "review.md"));
});

test("repository fixture supports filesystem-backed metadata diagnostics", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.context("contexts/invalid.md", {
    id: "context.invalid",
    owner: "qa",
    status: "active",
    whenToUse: ["TODO"],
  });

  const result = await catalog(fixture.root);
  const codes = new Set(
    result.diagnostics.map((diagnostic) => diagnostic.code),
  );
  assert.ok(codes.has(DIAGNOSTIC_IDS.META_INVALID_STATUS));
  assert.ok(codes.has(DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE));
  assert.ok(codes.has(DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY));
});
