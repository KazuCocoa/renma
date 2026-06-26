import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { catalog } from "../src/commands/catalog.js";
import { graph } from "../src/commands/graph.js";
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

  assert.ok(assetIds.includes("skill.testing.spec-review"));
  assert.ok(assetIds.includes("context.testing.boundary-value-analysis"));
  assert.ok(assetIds.includes("context.testing.negative-testing"));
  assert.ok(assetIds.includes("context.domain.payment.idempotency"));

  const graphResult = await graph(EXAMPLE_ROOT);
  const graphNodeIds = graphResult.nodes.map((node) => node.id);
  const graphEdges = graphResult.edges.map(
    (edge) => `${edge.from}->${edge.to}`,
  );

  assert.ok(graphNodeIds.includes("skill.testing.spec-review"));
  assert.ok(
    graphEdges.includes(
      "skill.testing.spec-review->context.testing.boundary-value-analysis",
    ),
  );
  assert.ok(
    graphEdges.includes(
      "skill.testing.spec-review->context.testing.negative-testing",
    ),
  );
});
