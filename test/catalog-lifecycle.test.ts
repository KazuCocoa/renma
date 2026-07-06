import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleDiagnostics } from "../src/catalog-lifecycle.js";
import type { CatalogEntry } from "../src/model.js";

test("lifecycleDiagnostics warns when deprecated governed context lacks superseded_by", () => {
  const diagnostics = lifecycleDiagnostics([
    contextEntry({
      id: "context.testing.old-boundary-analysis",
      status: "deprecated",
    }),
  ]);

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        "Deprecated shared context asset is missing superseded_by metadata.",
    ),
  );
});

test("lifecycleDiagnostics warns when superseded_by points to itself", () => {
  const diagnostics = lifecycleDiagnostics([
    contextEntry({
      id: "context.testing.boundary-analysis",
      status: "deprecated",
      supersededBy: ["context.testing.boundary-analysis"],
    }),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("superseded_by references itself"),
    ),
  );
});

test("lifecycleDiagnostics warns when superseded_by target is inactive", () => {
  const diagnostics = lifecycleDiagnostics([
    contextEntry({
      id: "context.testing.old-boundary-analysis",
      status: "deprecated",
      supersededBy: ["context.testing.new-boundary-analysis"],
    }),
    contextEntry({
      id: "context.testing.new-boundary-analysis",
      status: "archived",
    }),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes(
        'resolves to an inactive asset with status "archived"',
      ),
    ),
  );
});

test("lifecycleDiagnostics warns when superseded_by chain forms a cycle", () => {
  const diagnostics = lifecycleDiagnostics([
    contextEntry({
      id: "context.testing.old-a",
      status: "deprecated",
      supersededBy: ["context.testing.old-b"],
    }),
    contextEntry({
      id: "context.testing.old-b",
      status: "deprecated",
      supersededBy: ["context.testing.old-a"],
    }),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("superseded_by chain forms a cycle"),
    ),
  );
});

function contextEntry(options: {
  id: string;
  status: "experimental" | "stable" | "deprecated" | "archived";
  supersededBy?: string[];
}): CatalogEntry {
  return {
    id: options.id,
    kind: "context",
    sourcePath: `${options.id.replaceAll(".", "/")}.md`,
    contentHash: "sha256:test",
    metadata: {
      id: options.id,
      owner: "qa-platform",
      status: options.status,
      tags: [],
      whenToUse: ["Reviewing test design knowledge"],
      whenNotToUse: ["Non-test-design guidance"],
      requiresContext: [],
      optionalContext: [],
      conflicts: [],
      supersededBy: options.supersededBy ?? [],
    },
    metadataFields: {},
    metadataListItems: {},
  };
}
