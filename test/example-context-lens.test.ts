import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { graph } from "../src/commands/graph.js";
import { readiness } from "../src/commands/readiness.js";
import { scan } from "../src/scanner.js";

const EXAMPLE_ROOT = path.join(process.cwd(), "examples", "context-lens");

test("Context Lens example is clean, ready, and keeps its nested Skill relationships", async () => {
  const [scanResult, readinessReport, graphReport] = await Promise.all([
    scan(EXAMPLE_ROOT),
    readiness(EXAMPLE_ROOT),
    graph(EXAMPLE_ROOT),
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
    readinessReport.checks.every((check) => check.status === "pass"),
    true,
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
});
