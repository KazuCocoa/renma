import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { catalog, formatCatalogMarkdown } from "../src/commands/catalog.js";
import { graph } from "../src/commands/graph.js";
import { readiness } from "../src/commands/readiness.js";
import { scan } from "../src/scanner.js";

const EXAMPLE_ROOT = path.join(process.cwd(), "examples/context-repo");

test("example context repository scans and builds catalog/graph reports", async () => {
  const scanResult = await scan(EXAMPLE_ROOT);

  assert.equal(scanResult.diagnostics.length, 0);
  assert.ok(
    scanResult.scannedFileCount >= 5,
    "examples/context-repo should include multiple runnable assets.",
  );

  const catalogResult = await catalog(EXAMPLE_ROOT);
  const assetIds = catalogResult.catalog.assets.map((asset) => asset.id);
  const catalogMarkdown = formatCatalogMarkdown(catalogResult);

  assert.ok(assetIds.includes("skill.testing.spec-review"));
  assert.ok(assetIds.includes("context.testing.boundary-value-analysis"));
  assert.ok(assetIds.includes("context.testing.negative-testing"));
  assert.ok(assetIds.includes("context.domain.payment.idempotency"));
  assert.ok(assetIds.includes("lens.testing.spec-review.boundary-values"));
  assert.ok(
    catalogResult.catalog.dependencies.some(
      (dependency) =>
        dependency.from === "skill.testing.spec-review" &&
        dependency.to === "contexts/testing/negative-testing.md",
    ),
    "Catalog JSON evidence should preserve the declared path target.",
  );
  assert.match(
    catalogMarkdown,
    /### context\.testing\.negative-testing[\s\S]*- Dependents: requires:skill\.testing\.spec-review/,
  );
  assert.match(
    catalogMarkdown,
    /### lens\.testing\.spec-review\.boundary-values[\s\S]*- Dependents: requires:skill\.testing\.spec-review/,
  );

  const graphResult = await graph(EXAMPLE_ROOT);
  const graphNodeIds = graphResult.nodes.map((node) => node.id);
  const graphEdges = graphResult.edges.map(
    (edge) => `${edge.from}->${edge.to}`,
  );

  assert.ok(graphNodeIds.includes("skill.testing.spec-review"));
  assert.ok(
    graphEdges.includes(
      "skill.testing.spec-review->contexts/testing/negative-testing.md",
    ),
  );
  assert.ok(
    graphResult.edges.some(
      (edge) =>
        edge.from === "skill.testing.spec-review" &&
        edge.to === "contexts/testing/negative-testing.md" &&
        edge.targetId === "context.testing.negative-testing",
    ),
    "Graph should resolve the same path target shown in Catalog.",
  );
  assert.ok(
    graphEdges.includes(
      "skill.testing.spec-review->lens.testing.spec-review.boundary-values",
    ),
  );
  assert.ok(
    graphResult.edges.some(
      (edge) =>
        edge.from === "skill.testing.spec-review" &&
        edge.to === "lens.testing.spec-review.boundary-values" &&
        edge.targetId === "lens.testing.spec-review.boundary-values",
    ),
    "ID-based dependencies should continue to resolve.",
  );
  assert.ok(
    graphEdges.includes(
      "lens.testing.spec-review.boundary-values->context.testing.boundary-value-analysis",
    ),
  );
});

test("example context repository produces a stable readiness report shape", async () => {
  const [catalogResult, readinessReport] = await Promise.all([
    catalog(EXAMPLE_ROOT),
    readiness(EXAMPLE_ROOT),
  ]);
  const assetIds = catalogResult.catalog.assets.map((asset) => asset.id);
  const checkIds = readinessReport.checks.map((check) => check.id);

  assert.ok(["ready", "partial", "not_ready"].includes(readinessReport.level));
  assert.ok(assetIds.includes("skill.testing.spec-review"));
  assert.ok(assetIds.includes("context.testing.boundary-value-analysis"));
  assert.ok(assetIds.includes("context.testing.negative-testing"));
  assert.ok(assetIds.includes("lens.testing.spec-review.boundary-values"));

  assert.equal(readinessReport.summary.totalAssets, assetIds.length);
  assert.equal(
    readinessReport.summary.ownedAssets,
    readinessReport.summary.totalAssets,
  );
  assert.equal(readinessReport.summary.unownedAssets, 0);
  assert.equal(readinessReport.summary.nodeCount, assetIds.length);
  assert.ok(readinessReport.summary.edgeCount >= 3);
  assert.equal(
    readinessReport.summary.resolvedEdges,
    readinessReport.summary.edgeCount,
  );
  assert.equal(readinessReport.summary.unresolvedEdges, 0);
  assert.equal(readinessReport.summary.workflow.skillEntrypoints, 1);
  assert.equal(readinessReport.summary.workflow.readinessPercent, 100);
  assert.equal(readinessReport.summary.contextLens.totalLensCount, 1);
  assert.equal(readinessReport.summary.contextLens.validLensCount, 1);

  assert.ok(checkIds.includes("ownership.coverage"));
  assert.ok(checkIds.includes("graph.unresolved_edges"));
  assert.ok(checkIds.includes("workflow.context_closure"));
});
