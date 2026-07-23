import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { graph } from "../src/commands/graph.js";
import { readiness } from "../src/commands/readiness.js";
import { scan } from "../src/scanner.js";

const EXAMPLE_ROOT = path.join(process.cwd(), "examples", "context-lens");

test("Context Lens example is clean, ready, and reports explicit Discovery publication state", async () => {
  const [
    scanResult,
    readinessReport,
    graphReport,
    skill,
    specReviewLens,
    testDesignLens,
  ] = await Promise.all([
    scan(EXAMPLE_ROOT),
    readiness(EXAMPLE_ROOT),
    graph(EXAMPLE_ROOT),
    readFile(
      path.join(EXAMPLE_ROOT, "skills/testing/spec-review/SKILL.md"),
      "utf8",
    ),
    readFile(
      path.join(EXAMPLE_ROOT, "lenses/testing/spec-review-boundary-values.md"),
      "utf8",
    ),
    readFile(
      path.join(EXAMPLE_ROOT, "lenses/testing/test-design-boundary-values.md"),
      "utf8",
    ),
  ]);

  assert.equal(scanResult.diagnostics.length, 0);
  assert.deepEqual(scanResult.findings, []);
  assert.equal(scanResult.agentSkills.totalSkillCount, 1);
  assert.equal(scanResult.agentSkills.validSkillCount, 1);
  assert.equal(scanResult.agentSkills.warningCount, 0);
  assert.deepEqual(scanResult.agentSkills.results[0]?.issues, []);
  const contextLens = scanResult.contextLens;
  assert.ok(contextLens);
  assert.equal(contextLens.totalLensCount, 2);
  assert.equal(contextLens.validLensCount, 2);
  assert.equal(contextLens.invalidLensCount, 0);

  assert.equal(readinessReport.level, "ready");
  assert.equal(readinessReport.score, 100);
  assert.equal(
    readinessReport.checks
      .filter((check) => check.id !== "discovery.publication")
      .every((check) => check.status === "pass"),
    true,
  );
  assert.equal(
    readinessReport.checks.find((check) => check.id === "discovery.publication")
      ?.status,
    "warn",
  );
  assert.equal(
    readinessReport.summary.skillDiscovery.publishedEntrypointCount,
    0,
  );

  assert.equal(
    graphReport.nodes.some(
      (node) =>
        node.kind === "skill" &&
        node.sourcePath === "skills/testing/spec-review/SKILL.md",
    ),
    true,
  );
  assert.equal(
    graphReport.edges.some(
      (edge) =>
        edge.from === "skill.testing.spec-review" &&
        edge.targetId === "lens.testing.spec-review.boundary-values",
    ),
    true,
  );
  assert.equal(
    graphReport.edges.some(
      (edge) =>
        edge.from === "lens.testing.spec-review.boundary-values" &&
        edge.targetId === "context.testing.boundary-value-analysis",
    ),
    true,
  );

  assert.doesNotMatch(skill, /stays thin|thin routing/i);
  for (const heading of [
    "Selection Boundaries",
    "Required Inputs",
    "Instructions",
    "Expected Output",
    "When Not To Use",
    "Validation",
    "Completion Criteria",
  ]) {
    assert.match(skill, new RegExp(`^## ${heading}$`, "m"));
  }
  assert.match(
    skill,
    /renma\.requires-context: '\["context\.testing\.boundary-value-analysis"\]'/,
  );
  assert.match(
    skill,
    /renma\.requires-lens: '\["lens\.testing\.spec-review\.boundary-values"\]'/,
  );
  for (const lens of [specReviewLens, testDesignLens]) {
    assert.match(lens, /^## Interpretation Criteria$/m);
    assert.match(lens, /^## Evidence And Output$/m);
    assert.match(lens, /Cite|citations/);
  }
});
